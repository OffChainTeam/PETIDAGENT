/**
 * Deploy script for zkSync-compatible networks (zkSYS Testnet, chainId 57057)
 * Usage: npx hardhat deploy-zksync --script scripts/deploy-zksync.js --network zksystestnet
 * Or:   node scripts/deploy-zksync.js
 */
require("dotenv").config();
const { Wallet, Provider, ContractFactory } = require("zksync-ethers");
const fs = require("fs");
const path = require("path");

const RPC_URL     = "https://rpc-zk.tanenbaum.io";
const CHAIN_ID    = 57057;
const EXPLORER    = "https://explorer-zk.tanenbaum.io";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const TOKEN_NAME   = "PetID Passport";
const TOKEN_SYMBOL = "PETID";

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not set in .env");
  }

  console.log("=".repeat(60));
  console.log("PetID Web3 - zkSync Deploy (zkSYS Testnet)");
  console.log("=".repeat(60));
  console.log(`RPC: ${RPC_URL}`);
  console.log(`ChainID: ${CHAIN_ID}`);

  const provider = new Provider(RPC_URL);
  const wallet   = new Wallet(PRIVATE_KEY, provider);

  const deployer = wallet.address;
  const balance  = await provider.getBalance(deployer);
  console.log(`Deployer: ${deployer}`);
  console.log(`Balance:  ${(Number(balance) / 1e18).toFixed(6)} TSYS`);
  console.log("=".repeat(60));

  // Load compiled artifact (zkSync artifacts are in artifacts-zk/)
  const artifactPath = path.join(
    __dirname, "..", "artifacts-zk", "contracts", "PetRegistry.sol", "PetRegistry.json"
  );

  if (!fs.existsSync(artifactPath)) {
    console.log("zkSync artifacts not found. Compiling for zkSync...");
    const { execSync } = require("child_process");
    execSync("npx hardhat compile --network zksystestnet", { cwd: path.join(__dirname, ".."), stdio: "inherit" });
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  console.log(`\n📦 Deploying PetRegistry ("${TOKEN_NAME}" / "${TOKEN_SYMBOL}")...`);

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(deployer, deployer, TOKEN_NAME, TOKEN_SYMBOL);

  console.log(`  TX hash: ${contract.deploymentTransaction()?.hash}`);
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log(`✅ PetRegistry deployed to: ${contractAddress}`);
  console.log(`🔍 Explorer: ${EXPLORER}/address/${contractAddress}`);

  // Save to deployments.json
  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  let allDeployments = {};
  if (fs.existsSync(deploymentsPath)) {
    allDeployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }
  allDeployments["zksystestnet"] = {
    network: "zksystestnet",
    chainId: CHAIN_ID,
    contracts: { PetRegistry: contractAddress },
    deployer,
    treasury: deployer,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(deploymentsPath, JSON.stringify(allDeployments, null, 2));
  console.log(`💾 Saved to deployments.json`);

  // Update ABIs
  try {
    require("./update-abis.js");
    console.log("✅ ABIs updated");
  } catch (e) {
    console.log("⚠️  Run 'npm run update-abis' manually:", e.message);
  }

  console.log("\n" + "=".repeat(60));
  console.log("📝 Next steps — update these files:");
  console.log(`   CONTRACT_ADDRESS=${contractAddress}   (backend/.env)`);
  console.log(`   NEXT_PUBLIC_PET_REGISTRY_ADDRESS=${contractAddress}   (frontend/.env.local)`);
  console.log(`   RPC_URL=${RPC_URL}   (backend/.env)`);
  console.log(`   CHAIN_ID=${CHAIN_ID}   (backend/.env)`);
  console.log("=".repeat(60));

  return contractAddress;
}

main()
  .then((addr) => {
    console.log(`\nContract address: ${addr}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Deploy failed:", err.message);
    process.exit(1);
  });
