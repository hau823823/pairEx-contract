const hre = require("hardhat");
const { initDeploy } = require("../shared/utilities");
const { describe, it } = require("mocha");
const { expect } = require("chai");

describe("simple test", function () {
  const provider = hre.waffle.provider;

  const [deployer, gov, manager, feedPnlAddress, botAddress, trader] =
    provider.getWallets();
  const ethers = hre.ethers;

  let tradingStorageContract;
  let usdt;
  let tradingStorage;
  let tradingCallback;
  let referral;
  this.beforeEach(async () => {
    const deployAddress = await initDeploy(
      deployer,
      gov,
      manager,
      feedPnlAddress,
      botAddress
    );
    tradingStorageContract = deployAddress["pexTradingStorageV1"];
    usdt = deployAddress["usdt"];
    tradingStorage = deployAddress["pexTradingStorageV1"];
    tradingCallback = deployAddress["pexTradingCallbacksV1"];
    referral = deployAddress["pexReferralStorage"];
  });

  it("test register,bind code,set tier value, and distribute fee", async function () {
    const [deployerSigner, govSigner, managerSigner] =
      await ethers.getSigners();

    const rc = ethers.utils.formatBytes32String("suoha");

    await referral.connect(govSigner).registerCode(rc);

    expect(await referral.ownerCodes(govSigner.address, 0)).to.eq(
      ethers.utils.formatBytes32String("suoha")
    );
    await referral.connect(managerSigner).setTraderReferralCodeByUser(rc);

    const [code, address] = await referral.getTraderReferralInfo(
      manager.address
    );
    const str = ethers.utils.parseBytes32String(code);
    expect(str).to.eq("suoha");
    expect(address).eq(gov.address);

    await referral.connect(govSigner).setTier(0, 2000, 2300);
    const [rebate, discount] = await referral.tiers(0);
    expect(rebate).equal(2000);
    expect(discount).eq(2300);

    usdt.connect(deployerSigner).transfer(tradingStorage.address, 1e6 * 1000);

    // set deploySigner ad callback. avoid distributeReferralAdnSaveFee execution revert
    await tradingStorage
      .connect(govSigner)
      .setCallbacks(deployerSigner.address);
    const tx = await referral
      .connect(deployerSigner)
      .distributeReferralAndSaveFee(manager.address, 1e6 * 1000, 1e6 * 100);

    await expect(tx)
      .to.emit(referral, "SaveCharged")
      .withArgs(manager.address, code, 1e6 * 1000, 23 * 1e6);
    await expect(tx)
      .to.emit(referral, "RebateCharged")
      .withArgs(govSigner.address, code, 1e6 * 1000, 20 * 1e6);
    expect(await referral.rebate(govSigner.address)).eq(20 * 1e6);
    expect(await referral.save(managerSigner.address)).eq(23 * 1e6);
  });

  it("test bind self fail", async function () {
    const [deployerSigner, testSigner] = await ethers.getSigners();

    const rc = ethers.utils.formatBytes32String("suoha");

    await referral.connect(deployerSigner).registerCode(rc);
    await expect(
      referral.connect(deployerSigner).setTraderReferralCodeByUser(rc)
    ).to.be.revertedWith("SELF_REFERAL_FORBIDEN");
  });

  it("test circle bind fail", async function () {
    const [deployerSigner, testSigner] = await ethers.getSigners();

    const rc = ethers.utils.formatBytes32String("suoha");

    await referral.connect(deployerSigner).registerCode(rc);
    await referral.connect(testSigner).setTraderReferralCodeByUser(rc);

    const rc2 = ethers.utils.formatBytes32String("suoha2");
    await referral.connect(testSigner).registerCode(rc2);

    await expect(
      referral.connect(deployerSigner).setTraderReferralCodeByUser(rc2)
    ).to.be.revertedWith("CIRCLE_REFERRAL_FORBIDEN");
  });

  it("test code number limit", async function () {
    const [deploySigner, govSigner] = await ethers.getSigners();
    const rc1 = ethers.utils.formatBytes32String("suoha");
    const rc2 = ethers.utils.formatBytes32String("suoha2");
    const rc3 = ethers.utils.formatBytes32String("suoha3");

    await referral.connect(govSigner).setMaxCodes(2);

    expect(await referral.connect(deploySigner).registerCode(rc1)).to.be.ok;
    expect(await referral.connect(deploySigner).registerCode(rc2)).to.be.ok;
    await expect(
      referral.connect(deploySigner).registerCode(rc3)
    ).to.be.revertedWith("EXCEED_CODE_LIMIT");
  });

  it("test callback referral storage set success", async function() {
    expect(await tradingCallback.referralStorage()).to.eq(referral.address)
  })

  it("test change referral code", async ()=>{
    const [deployerSigner, govSigner, managerSigner] =
      await ethers.getSigners();

    const rc = ethers.utils.formatBytes32String("suoha");
    await referral.connect(govSigner).registerCode(rc);
    const rc2 = ethers.utils.formatBytes32String("suoha2")
    await referral.connect(managerSigner).registerCode(rc2);

    await referral.connect(deployerSigner).setTraderReferralCodeByUser(rc)
    expect(await referral.referrerCount(govSigner.address)).to.eq(1)
    await expect(referral.connect(deployerSigner).setTraderReferralCodeByUser(rc2)).to.be.revertedWith("CHANGE_CODE_NOT_ALLOWED")

    await referral.connect(govSigner).setChangeCode(true)
    await referral.connect(deployerSigner).setTraderReferralCodeByUser(rc2)

    expect(await referral.referrerCount(managerSigner.address)).to.eq(1)
    expect(await referral.referrerCount(govSigner.address)).to.eq(0)

  })
});
