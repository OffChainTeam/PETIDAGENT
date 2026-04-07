const express = require('express');
const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

// ============ Config ============

const RPC_URL = process.env.RPC_URL || 'https://rpc-pob.dev11.top';
const FUNDER_PRIVATE_KEY = process.env.FUNDER_PRIVATE_KEY || '';
const FAUCET_AMOUNT = process.env.FAUCET_AMOUNT || '0.01';
const FAUCET_MIN_FUNDER_BALANCE = process.env.FAUCET_MIN_FUNDER_BALANCE || '0.1';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// ============ Helpers ============

let _provider = null;
let _funderWallet = null;

function getProvider() {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(RPC_URL);
  }
  return _provider;
}

function getFunderWallet() {
  if (!_funderWallet) {
    if (!FUNDER_PRIVATE_KEY) {
      return null;
    }
    const provider = getProvider();
    _funderWallet = new ethers.Wallet(FUNDER_PRIVATE_KEY, provider);
  }
  return _funderWallet;
}

// ============ Routes ============

/**
 * GET /api/faucet/status
 * Check faucet availability and funder balance
 */
router.get('/status', async (req, res) => {
  try {
    const wallet = getFunderWallet();
    if (!wallet) {
      return res.json({
        success: true,
        data: {
          available: false,
          reason: 'Faucet no configurado. Contacta al administrador.',
          funderAddress: null,
          funderBalance: '0',
          amountPerClaim: FAUCET_AMOUNT,
        },
      });
    }

    const provider = getProvider();
    const balance = await provider.getBalance(wallet.address);
    const balanceEth = ethers.formatEther(balance);
    const minBalance = ethers.parseEther(FAUCET_MIN_FUNDER_BALANCE);
    const hasFunds = balance > minBalance;

    res.json({
      success: true,
      data: {
        available: hasFunds,
        reason: hasFunds ? null : 'La cuenta del faucet no tiene fondos suficientes. Intenta más tarde.',
        funderAddress: wallet.address,
        funderBalance: balanceEth,
        amountPerClaim: FAUCET_AMOUNT,
      },
    });
  } catch (err) {
    console.error('[Faucet] status error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Error al consultar el estado del faucet. Intenta más tarde.',
    });
  }
});

/**
 * GET /api/faucet/check/:address
 * Check if an address has already claimed
 */
router.get('/check/:address', async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({
        success: false,
        error: 'Dirección de billetera inválida.',
      });
    }

    const { data, error } = await supabase
      .from('faucet_claims')
      .select('address, amount, tx_hash, claimed_at')
      .eq('address', address)
      .maybeSingle();

    if (error && error.message.includes('faucet_claims')) {
      // Table doesn't exist yet - treat as no claims
      return res.json({ success: true, data: { claimed: false, claim: null } });
    }

    if (error) {
      console.error('[Faucet] check error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Error al verificar el estado. Intenta más tarde.',
      });
    }

    res.json({
      success: true,
      data: {
        claimed: !!data,
        claim: data || null,
      },
    });
  } catch (err) {
    console.error('[Faucet] check error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor.',
    });
  }
});

/**
 * POST /api/faucet/claim
 * Send funds to a new wallet address
 */
router.post('/claim', async (req, res) => {
  try {
    const { address } = req.body;

    if (!address || !/^0x[a-fA-F0-9]{40}$/i.test(address)) {
      return res.status(400).json({
        success: false,
        error: 'Dirección de billetera inválida. Debe ser una dirección Ethereum válida (0x...).',
      });
    }

    const normalizedAddress = address.toLowerCase();

    // Check if funder wallet is configured
    const wallet = getFunderWallet();
    if (!wallet) {
      return res.status(503).json({
        success: false,
        error: 'El faucet no está configurado. Contacta al administrador.',
      });
    }

    // Check funder balance
    const provider = getProvider();
    const funderBalance = await provider.getBalance(wallet.address);
    const minBalance = ethers.parseEther(FAUCET_MIN_FUNDER_BALANCE);
    const sendAmount = ethers.parseEther(FAUCET_AMOUNT);

    if (funderBalance < minBalance) {
      return res.status(503).json({
        success: false,
        error: 'La cuenta del faucet no tiene fondos suficientes en este momento. Intenta más tarde.',
      });
    }

    if (funderBalance < sendAmount) {
      return res.status(503).json({
        success: false,
        error: 'Fondos insuficientes en el faucet para esta operación.',
      });
    }

    // Check if already claimed (in Supabase)
    let alreadyClaimed = false;
    try {
      const { data: existing, error: checkErr } = await supabase
        .from('faucet_claims')
        .select('address')
        .eq('address', normalizedAddress)
        .maybeSingle();

      if (!checkErr && existing) {
        alreadyClaimed = true;
      }
    } catch (dbErr) {
      // If table doesn't exist, proceed (first user ever)
      console.warn('[Faucet] DB check warning:', dbErr.message);
    }

    if (alreadyClaimed) {
      return res.status(409).json({
        success: false,
        error: 'Esta billetera ya recibió fondos anteriormente. Solo se permite un reclamo por dirección.',
      });
    }

    // Send the transaction
    console.log(`[Faucet] Sending ${FAUCET_AMOUNT} TSYS to ${normalizedAddress}...`);

    const tx = await wallet.sendTransaction({
      to: normalizedAddress,
      value: sendAmount,
    });

    console.log(`[Faucet] TX sent: ${tx.hash}`);

    // Wait for confirmation
    const receipt = await tx.wait();
    console.log(`[Faucet] TX confirmed in block ${receipt.blockNumber}`);

    // Record the claim in Supabase
    try {
      await supabase.from('faucet_claims').insert({
        address: normalizedAddress,
        amount: FAUCET_AMOUNT,
        tx_hash: tx.hash,
      });
    } catch (dbErr) {
      // Non-blocking: tx already sent, just log the DB error
      console.error('[Faucet] Failed to record claim in DB:', dbErr.message);
    }

    const explorerUrl = process.env.EXPLORER_URL || 'https://explorer-pob.dev11.top';

    res.json({
      success: true,
      data: {
        txHash: tx.hash,
        amount: FAUCET_AMOUNT,
        to: normalizedAddress,
        explorerUrl: `${explorerUrl}/tx/${tx.hash}`,
        blockNumber: receipt.blockNumber,
      },
    });
  } catch (err) {
    console.error('[Faucet] claim error:', err.message);

    // Parse common errors for friendly messages
    let friendlyError = 'Error al enviar fondos. Intenta más tarde.';
    if (err.message.includes('insufficient funds')) {
      friendlyError = 'La cuenta del faucet no tiene fondos suficientes.';
    } else if (err.message.includes('nonce')) {
      friendlyError = 'Error de transacción (nonce). Intenta de nuevo en unos segundos.';
    } else if (err.message.includes('network')) {
      friendlyError = 'Error de red. Verifica tu conexión e intenta de nuevo.';
    }

    res.status(500).json({
      success: false,
      error: friendlyError,
    });
  }
});

module.exports = router;
