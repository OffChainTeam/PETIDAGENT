const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainId = hre.network.config.chainId;
  
  console.log("=".repeat(60));
  console.log("PetID Web3 - Deployment Script");
  console.log("=".repeat(60));
  console.log(`Network: ${hre.network.name} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} SYS`);
  console.log("=".repeat(60));
  
  // Treasury is the deployer for MVP
  const treasury = deployer.address;

  // Token name & symbol (edit here before deploying)
  const TOKEN_NAME   = "PetID Passport";
  const TOKEN_SYMBOL = "PETID";

  console.log(`\n📦 Deploying PetRegistry ("${TOKEN_NAME}" / "${TOKEN_SYMBOL}")...`);
  const PetRegistry = await hre.ethers.getContractFactory("PetRegistry");
  const petRegistry = await PetRegistry.deploy(deployer.address, treasury, TOKEN_NAME, TOKEN_SYMBOL);
  await petRegistry.waitForDeployment();
  
  const petRegistryAddress = await petRegistry.getAddress();
  console.log(`✅ PetRegistry deployed to: ${petRegistryAddress}`);
  
  // Get deployment block
  const deploymentBlock = await hre.ethers.provider.getBlockNumber();
  console.log(`📦 Deployment block: ${deploymentBlock}`);
  
  // Save deployment info
  const deployment = {
    network: hre.network.name,
    chainId: chainId,
    contracts: {
      PetRegistry: petRegistryAddress,
    },
    deployer: deployer.address,
    treasury: treasury,
    deploymentBlock: deploymentBlock,
    deployedAt: new Date().toISOString(),
  };
  
  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  
  // Load existing deployments or create new
  let allDeployments = {};
  if (fs.existsSync(deploymentsPath)) {
    allDeployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }
  
  allDeployments[hre.network.name] = deployment;
  
  fs.writeFileSync(deploymentsPath, JSON.stringify(allDeployments, null, 2));
  console.log(`💾 Deployment info saved to deployments.json`);
  
  // Update ABIs in frontend
  console.log("\n📋 Updating ABIs in frontend...");
  try {
    require("./update-abis.js");
    console.log("✅ ABIs updated successfully");
  } catch (error) {
    console.log("⚠️  Could not update ABIs automatically:", error.message);
    console.log("   Run 'npm run update-abis' manually");
  }
  
  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("🎉 Deployment Complete!");
  console.log("=".repeat(60));
  console.log(`\nPetRegistry: ${petRegistryAddress}`);
  
  // Explorer link
  const explorerUrls = {
    testnet: "https://explorer.tanenbaum.io",
    zksys: "https://explorer-pob.dev11.top",
    zksystestnet: "https://explorer-zk.tanenbaum.io",
    mainnet: "https://explorer.syscoin.org",
  };
  
  const explorer = explorerUrls[hre.network.name];
  if (explorer) {
    console.log(`\n🔍 Explorer: ${explorer}/address/${petRegistryAddress}`);
  }
  
  // Auto-verify on supported networks
  const verifiableNetworks = ["testnet", "zksys", "zksystestnet", "mainnet"];
  if (verifiableNetworks.includes(hre.network.name)) {
    console.log("\n🔍 Verifying contract on explorer...");
    try {
      // Wait a few blocks for the explorer to index the contract
      console.log("   Waiting 10s for explorer to index...");
      await new Promise((r) => setTimeout(r, 10000));
      await hre.run("verify:verify", {
        address: petRegistryAddress,
        constructorArguments: [deployer.address, treasury, TOKEN_NAME, TOKEN_SYMBOL],
      });
      console.log("✅ Contract verified!");
    } catch (err) {
      if (err.message.includes("Already Verified") || err.message.includes("already verified")) {
        console.log("✅ Contract already verified.");
      } else {
        console.log("⚠️  Verification failed:", err.message);
        console.log("   Run manually: npm run verify -- " + petRegistryAddress +
          ` --constructor-args '["${deployer.address}","${treasury}","${TOKEN_NAME}","${TOKEN_SYMBOL}"]'`);
      }
    }
  }

  console.log("\n📝 Next steps:");
  console.log("1. Copy contract address to frontend/.env.local");
  console.log("2. Run 'npm run update-abis' if not done automatically");

  return deployment;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
