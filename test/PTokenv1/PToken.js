const { expect } = require("chai");
const {address} = require("hardhat/internal/core/config/config-validation");
const {BigNumber} = require("ethers");

const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
function sleep(sec) {
  return new Promise(resolve => {
    setTimeout(resolve, sec*1000);
  })
}

describe("PTokenV1 contract", function () {
  const provider = waffle.provider
  const [owner, gov,unplFeed,applyAddress,receiverAddress,receiverAddress1,receiverAddress2,callback] = provider.getWallets();
  const PRECISION = 1000000
  const usdtSupplyBig = BigNumber.from("100000000000000000",10)
  let TestToken,PTokenV1;
  let requestId = 0;
  const LockDurationSecond = 60*60*24*3

  before(async () => {
    const PTokenFactory = await ethers.getContractFactory("PTokenV1");
    PTokenV1 = await PTokenFactory.deploy();

    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    TestToken = await TestTokenFactory.deploy("USDT","USDT",6,owner.address);
    await TestToken.mint(owner.address,usdtSupplyBig);
    expect(await TestToken.balanceOf(owner.address)).equal(usdtSupplyBig);

    const PairexTradingStorageV1Factory = await ethers.getContractFactory("PairexTradingStorageV1");
    const PairexTradingStorageV1 = await PairexTradingStorageV1Factory.deploy();
    await PairexTradingStorageV1.initialize(gov.address,TestToken.address,TestToken.address)
    expect(await PairexTradingStorageV1.gov()).equal(gov.address);

    // callback 地址假装是合约
    await PTokenV1.initialize("PLP","PLP",6,TestToken.address,callback.address,PairexTradingStorageV1.address,unplFeed.address)

    await TestToken.mint(callback.address,100 * PRECISION);
    await TestToken.connect(callback).approve(PTokenV1.address,MAX_INT)

    let adds=[applyAddress,receiverAddress,receiverAddress1,receiverAddress2]
    for(let i=0;i<adds.length;i++){
      if(i===0){
        await TestToken.mint(adds[i].address,usdtSupplyBig);
      }
      await TestToken.connect(adds[i]).approve(PTokenV1.address,MAX_INT)
    }
  })

  it("PTokenV1 complicated test apply and run", async function () {
    // 添加流动性
    var applyAmount = 10000000000
    await PTokenV1.connect(applyAddress).applyDeposit(applyAmount,receiverAddress.address)
    await expect(
      PTokenV1.connect(applyAddress).runDeposit(++requestId,0,0)
    ).to.be.revertedWith('not feed address');

    // 1. 之前把 u 转走
    TestToken.connect(applyAddress).transfer(receiverAddress.address, usdtSupplyBig)
    await expect(
      PTokenV1.connect(unplFeed).runDeposit(requestId, 0, 0)
    ).to.be.revertedWith('usdt amount not enough');
    TestToken.connect(receiverAddress).transfer(applyAddress.address, usdtSupplyBig)
    // 2. 之前取消 approve
    TestToken.connect(applyAddress).approve(PTokenV1.address, 0)
    await expect(
      PTokenV1.connect(unplFeed).runDeposit(requestId, 0, 0)
    ).to.be.revertedWith('please approve');
    TestToken.connect(applyAddress).approve(PTokenV1.address, MAX_INT)

    await PTokenV1.connect(unplFeed).runDeposit(requestId,0,0)
    expect(await PTokenV1.totalSupply()).equal(applyAmount);
    expect(await PTokenV1.balanceOf(receiverAddress.address)).equal(applyAmount);
    expect(
      (await PTokenV1.LockInfo("0x0000000000000000000000000000000000000000000000000000000000000001")).assets
    ).to.equal(applyAmount);

    await provider.send("evm_increaseTime", [LockDurationSecond]);
    await provider.send("evm_mine");

    // 赎回流动性
    await PTokenV1.connect(receiverAddress).applyWithdraw(applyAmount,receiverAddress.address)
    await PTokenV1.connect(unplFeed).runWithdraw(++requestId,0,0)
    expect(
      (await PTokenV1.LockInfo("0x0000000000000000000000000000000000000000000000000000000000000001")).assets
    ).to.equal(0);

    // 测试存在未解锁情况
    applyAmount = 10000000000
    // 添加流动性
    await PTokenV1.connect(applyAddress).applyDeposit(applyAmount,receiverAddress.address)
    await PTokenV1.connect(unplFeed).runDeposit(++requestId,0,0)
    expect(await PTokenV1.totalSupply()).equal(applyAmount);
    expect((await PTokenV1.AddressAlreadyApply(applyAddress.address)).deposit).to.equal("0")
    await provider.send("evm_increaseTime", [LockDurationSecond/2]);
    await provider.send("evm_mine");
    // 再次添加
    await PTokenV1.connect(applyAddress).applyDeposit(applyAmount,receiverAddress.address)
    await PTokenV1.connect(unplFeed).runDeposit(++requestId,0,0)
    expect(await PTokenV1.totalSupply()).to.equal(applyAmount*2);
    await provider.send("evm_increaseTime", [LockDurationSecond/2]);
    await provider.send("evm_mine");

    // 此时只解锁了 applyAmount 这么多
    await expect(
      (PTokenV1.connect(receiverAddress).applyWithdraw((applyAmount*2),receiverAddress.address))
    ).to.be.revertedWith('insufficient unlocked');

    await PTokenV1.connect(receiverAddress).applyWithdraw((applyAmount/2),receiverAddress.address)
    await PTokenV1.connect(unplFeed).runWithdraw(++requestId,0,0)
    expect(await TestToken.balanceOf(receiverAddress.address)).equal(applyAmount*1.5);

    // 全部解锁了
    await provider.send("evm_increaseTime", [LockDurationSecond]);
    await provider.send("evm_mine");
    await PTokenV1.connect(receiverAddress).applyWithdraw((applyAmount*1.5),receiverAddress.address)

    await PTokenV1.connect(unplFeed).runWithdraw(++requestId,0,0)
    expect(await TestToken.balanceOf(receiverAddress.address)).equal(applyAmount*3);
    await TestToken.connect(receiverAddress).transfer(applyAddress.address,applyAmount*3)

    // 判断队列清空
    expect(
      (await PTokenV1.LockInfo("0x0000000000000000000000000000000000000000000000000000000000000001")).assets
    ).to.equal(0);
    expect(
      (await PTokenV1.LockInfo("0x0000000000000000000000000000000000000000000000000000000000000002")).assets
    ).to.equal(0);
    expect(
      (await PTokenV1.LockInfo("0x0000000000000000000000000000000000000000000000000000000000000003")).assets
    ).to.equal(0);

    // 测试取消函数
    await PTokenV1.connect(applyAddress).applyDeposit(applyAmount,applyAddress.address)
    expect(
      (await PTokenV1.AddressAlreadyApply(applyAddress.address)).deposit
    ).equal(++requestId);
    await PTokenV1.connect(applyAddress).cancelApply(requestId)
    expect(
      (await PTokenV1.AddressAlreadyApply(applyAddress.address)).deposit
    ).equal(0);
    await expect(
      PTokenV1.connect(unplFeed).runDeposit(requestId,0,0)
    ).to.be.revertedWith('request id not found');
    await expect(
      PTokenV1.connect(unplFeed).runDeposit(requestId,0,1)
    ).to.be.revertedWith('uPnl verify failed');

    await PTokenV1.connect(applyAddress).applyDeposit(applyAmount,applyAddress.address)
    expect(
      (await PTokenV1.AddressAlreadyApply(applyAddress.address)).deposit
    ).equal(8);
    await PTokenV1.connect(unplFeed).runDeposit(++requestId,0,0)
    expect(
      (await PTokenV1.AddressAlreadyApply(applyAddress.address)).deposit
    ).equal(0);
    expect(await PTokenV1.totalSupply()).equal(applyAmount);
    expect(
      (await PTokenV1.LockInfo("0x0000000000000000000000000000000000000000000000000000000000000004")).assets
    ).to.equal(applyAmount);

    await provider.send("evm_increaseTime", [LockDurationSecond]);
    await provider.send("evm_mine");
    await PTokenV1.connect(applyAddress).applyWithdraw(applyAmount,applyAddress.address)
    expect(
      (await PTokenV1.AddressAlreadyApply(applyAddress.address)).withdraw
    ).equal(++requestId);
    await PTokenV1.connect(applyAddress).cancelApply(requestId)
    expect(
      (await PTokenV1.AddressAlreadyApply(applyAddress.address)).withdraw
    ).equal(0);

    await PTokenV1.connect(applyAddress).applyWithdraw(applyAmount,applyAddress.address)
    await PTokenV1.connect(unplFeed).runWithdraw(++requestId,0,0)
    expect(
      (await PTokenV1.AddressAlreadyApply(applyAddress.address)).withdraw
    ).equal(0);
    expect(await PTokenV1.totalSupply()).equal(0);
  })

  it("PTokenV1 transfer", async function () {
    var amount = 10000*PRECISION

    // 先批准
    await TestToken.connect(applyAddress).approve(receiverAddress.address,MAX_INT)
    await PTokenV1.connect(applyAddress).approve(receiverAddress.address,MAX_INT)
    await PTokenV1.connect(receiverAddress).approve(receiverAddress1.address,MAX_INT)
    await PTokenV1.connect(receiverAddress1).approve(receiverAddress.address,MAX_INT)

    // 尝试转账 USDT
    await TestToken.connect(applyAddress).transfer(receiverAddress.address,amount);
    expect(await TestToken.balanceOf(receiverAddress.address)).to.equal(amount);
    await TestToken.connect(receiverAddress).transfer(applyAddress.address,amount);
    expect(await TestToken.balanceOf(receiverAddress.address)).to.equal(0);
    await TestToken.connect(receiverAddress).transferFrom(applyAddress.address,receiverAddress.address,amount);
    expect(await TestToken.balanceOf(receiverAddress.address)).to.equal(amount);
    await TestToken.connect(receiverAddress).transfer(applyAddress.address,amount)
    expect(await TestToken.balanceOf(receiverAddress.address)).to.equal(0);

    // applyAddress 押 100 给 0 ，0 转 79 到 1，0 赎回 20，1 转 44 到 0，1 转 10 到 2，0 转 17 到 applyAddress，
    // applyAddress 赎回 17,applyAddress 转 100 到 2,,2 再质押 50，后赎回 0 ，增加已实现盈亏为 10 u，
    // 赎回全部然后 u 全部转回 applyAddress
    depositAmount = 100 * PRECISION
    await PTokenV1.connect(applyAddress).applyDeposit(depositAmount,receiverAddress.address)
    await PTokenV1.connect(unplFeed).runDeposit(++requestId,0,0)
    await expect(
      PTokenV1.connect(receiverAddress).transfer(receiverAddress1.address,79 * PRECISION)
    ).to.be.revertedWith('insufficient unlocked');
    await expect(
      PTokenV1.connect(receiverAddress1).transferFrom(receiverAddress.address,receiverAddress1.address,79 * PRECISION)
    ).to.be.revertedWith('insufficient unlocked');
    await provider.send("evm_increaseTime", [LockDurationSecond]);
    await provider.send("evm_mine");
    await PTokenV1.connect(receiverAddress).transfer(receiverAddress1.address,79 * PRECISION)
    await PTokenV1.connect(receiverAddress).applyWithdraw(20 * PRECISION,receiverAddress.address)
    await PTokenV1.connect(unplFeed).runWithdraw(++requestId,5 * PRECISION,0)
    // 此时未实现盈亏 5 U（LP 亏损）,正常来说 receiverAddress 得到 20 * （100 - 5）/ 100 = 19 u
    expect(await TestToken.balanceOf(receiverAddress.address)).to.equal(19 * PRECISION);

    await PTokenV1.connect(receiverAddress).transferFrom(receiverAddress1.address,receiverAddress.address,44 * PRECISION)
    await PTokenV1.connect(receiverAddress1).transfer(receiverAddress2.address,10 * PRECISION)
    await PTokenV1.connect(receiverAddress).transfer(applyAddress.address,17 * PRECISION)

    await PTokenV1.connect(applyAddress).applyWithdraw(17 * PRECISION,applyAddress.address)
    await PTokenV1.connect(unplFeed).runWithdraw(++requestId,-8 * PRECISION,0);
    // 此时未实现盈亏 -8 U（LP 盈利）,正常来说得到 17 * （81 + 8）/ 80 = 18.9125 u
    expect(await TestToken.balanceOf(applyAddress.address)).to.equal("99999999918912500");

    await TestToken.connect(applyAddress).transfer(receiverAddress2.address,100 * PRECISION)
    await PTokenV1.connect(receiverAddress2).applyDeposit(50 * PRECISION,receiverAddress2.address)
    await PTokenV1.connect(unplFeed).runDeposit(++requestId,-5 * PRECISION,0)
    // 此时未实现盈亏 -5 U（LP 盈利）,正常来说得到 50 * 63 /（62.0875 + 5） = 46.953605 p
    expect(await PTokenV1.balanceOf(receiverAddress2.address)).to.equal((46.953605 + 10) * PRECISION);

    await PTokenV1.connect(receiverAddress).applyWithdraw(28 * PRECISION,receiverAddress.address)
    await PTokenV1.connect(unplFeed).runWithdraw(++requestId,-3 * PRECISION,0);
    // 此时未实现盈亏 -3 U（LP 盈利）,正常来说得到 28 * (112.0875 + 3)/109.953605  = 29.307361 u
    expect(await TestToken.balanceOf(receiverAddress.address)).to.equal((29.307361+19) * PRECISION);
    await TestToken.connect(receiverAddress).transfer(applyAddress.address,(29.307361+19) * PRECISION);

    // 添加 10 u 已实现盈亏
    const pnlBig = BigNumber.from(10 * PRECISION,10)
    await PTokenV1.connect(callback).receiveAssets(pnlBig.toString(),applyAddress.address)
    await PTokenV1.connect(receiverAddress1).applyWithdraw(25 * PRECISION,receiverAddress1.address)
    await PTokenV1.connect(unplFeed).runWithdraw(++requestId,-3 * PRECISION,0);
    // 此时未实现盈亏 -3 U（LP 盈利）,正常来说得到 25 * (92.780139 + 3)/81.953605  = 29.217793 u
    expect(await TestToken.balanceOf(receiverAddress1.address)).to.equal(29.217793 * PRECISION);
    await TestToken.connect(receiverAddress1).transfer(applyAddress.address,29.217793 * PRECISION);

    await provider.send("evm_increaseTime", [LockDurationSecond]);
    await provider.send("evm_mine");
    await PTokenV1.connect(receiverAddress2).applyWithdraw((46.953605 + 10) * PRECISION,applyAddress.address)
    await PTokenV1.connect(unplFeed).runWithdraw(++requestId,0,0);
    await TestToken.connect(receiverAddress2).transfer(applyAddress.address,50 * PRECISION);
    expect(await TestToken.balanceOf(applyAddress.address)).to.equal(usdtSupplyBig.add(pnlBig));
    expect(await PTokenV1.totalAssets()).to.equal(0);
    expect(await PTokenV1.totalSupply()).to.equal(0);
  })

  after(async ()=>{
    const LockId=await PTokenV1.LockId()

    for(let i = 0;i<Number(LockId)+1;i++){
      var str = i<10?"0"+i:i;
      expect(
        (await PTokenV1.LockInfo("0x00000000000000000000000000000000000000000000000000000000000000"+str)).assets
      ).to.equal(0);
    }
  })
})