// contracts/PEXSwap.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import '@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol';
import "../interfaces/IStorageT.sol";
import "../interfaces/IUniversalRouter.sol";
import "../interfaces/IAllowanceTransfer.sol";
import "../interfaces/IStaking.sol";
import "../interfaces/IesPEX.sol";

contract EcosystemManage is Initializable{
    using SafeERC20 for IERC20;
    using MathUpgradeable for uint;

    IStorageT public storageT;
    IUniversalRouter public universalRouter;
    IStaking public rewardRouter;
    IStaking public plpStaking;
    IERC20 public usdt;
    IERC20 public pex;
    IesPEX public esPEX;

    // ecosystem shared params (60%)
    uint public floorPriceP;       // 5%
    uint public stakePexRewardP;  // 35%
    //buyBack
    uint public stakePlpRewardP;  // 5%
    uint public tradeMiningP;     // 15%

    // ecosystem shared funds
    uint public floorPriceFund;   // temp not used, stored in this contract
    uint public stakePexReward;
    uint public stakePlpReward;
    uint public tradeMiningFund; // temp not used, stored in this contract

    // triggered address
    mapping (address => bool) public isAddrListed;

    // previous reward amounts
    uint public previousStakePexReward;
    uint public previousStakePlpReward;

    uint public minPexBuyBackAmount;

    // Events
    event NumberUpdated(string name,uint value);
    event WhiteListsAdded(address a);
    event WhiteListsRemoved(address a);
    event AddressUpdated(string name, address a);
    event ScheduledTriggered(address a, uint amount);
    event RandomBuyBack(address a, uint amount);
    event RandomRewardPlp(address a, uint pexAmount, uint esPexAmount);

    function initialize(
        address _storageT,
        address _UniversalRouter,
        address _USDT,
        address _PEX,
        address _ESPEX
    ) external initializer {
        require(
            _storageT != address(0) &&
            _UniversalRouter != address(0) &&
            _USDT != address(0) &&
            _PEX != address(0) &&
            _ESPEX != address(0)
        );

        storageT = IStorageT(_storageT);
        universalRouter = IUniversalRouter(_UniversalRouter);
        pex = IERC20(_PEX);
        usdt = IERC20(_USDT);
        esPEX = IesPEX(_ESPEX);

        minPexBuyBackAmount = 2 * 1e6;
    }

    // Modifiers
    modifier onlyGov(){
        require(msg.sender == storageT.gov(), "GOV_ONLY");
        _;
    }

    modifier onlyStorageT() {
        require(msg.sender == address(storageT), "STORAGET_ONLY");
        _;
    }

    modifier onlyWhiteList() {
        require(isAddrListed[msg.sender], "NOT_IN_WHITELIST");
        _;
    }

    // set params
    function addTriggeredWhiteList(address _addr) external onlyGov{
        require(_addr != address(0));
        isAddrListed[_addr] = true;
        emit WhiteListsAdded(_addr);
    }
    function removeTriggeredWhiteList(address _addr) external onlyGov{
        require(_addr != address(0));
        isAddrListed[_addr] = false;
        emit WhiteListsRemoved(_addr);
    }

    function setEcosystemSharesP(
        uint _floorPriceP,
        uint _stakePexRewardP,
        uint _stakePlpRewardP,
        uint _tradeMiningP
    ) external onlyGov {
        require(checkEcoDistributeP(_floorPriceP, _stakePexRewardP, _stakePlpRewardP, _tradeMiningP), "SHARES_PERCENT_WRONG");

        floorPriceP = _floorPriceP;
        stakePexRewardP = _stakePexRewardP;
        stakePlpRewardP = _stakePlpRewardP;
        tradeMiningP = _tradeMiningP;

        emit NumberUpdated("floorPriceP", floorPriceP);
        emit NumberUpdated("stakePexRewardP", stakePexRewardP);
        emit NumberUpdated("stakePlpRewardP", stakePlpRewardP);
        emit NumberUpdated("tradeMiningP", tradeMiningP);
    }

    function setUniversalRouter(address _universalRouter) external onlyGov{
        require(_universalRouter != address(0));
        universalRouter = IUniversalRouter(_universalRouter);
        emit AddressUpdated("rewardRouter", address(universalRouter));
    }

    function setRewardRouter(address _rewardRouter) external onlyGov{
        require(_rewardRouter != address(0));
        rewardRouter = IStaking(_rewardRouter);
        emit AddressUpdated("rewardRouter", address(rewardRouter));
    }

    function setPlpStaking(address _plpStaking) external onlyGov{
        require(_plpStaking != address(0));
        plpStaking = IStaking(_plpStaking);
        emit AddressUpdated("plpStaking", address(plpStaking));
    }

    function setMinPexBuyBackAmount(uint _minPexBuyBackAmount) external onlyGov {
        require(_minPexBuyBackAmount > 0, "minPexBuyBackAmount too small");
        minPexBuyBackAmount = _minPexBuyBackAmount;
        emit NumberUpdated("minPexBuyBackAmount", minPexBuyBackAmount);
    }

    function Approve(address token,address _spender) public onlyGov{
        IERC20(token).safeApprove(_spender,type(uint256).max);
    }

    function CancelApporve(address token,address _spender) public onlyGov{
        uint256 allowanceAmount;
        allowanceAmount = IERC20(token).allowance(address(this), _spender);
        IERC20(token).safeDecreaseAllowance(_spender,allowanceAmount);
    }

    function ApprovePERMIT2(address _PERMIT2,address token,address _spender) public onlyGov{
        IAllowanceTransfer(_PERMIT2).approve(token, _spender, type(uint160).max, type(uint48).max);
    }

    function CancelApprovePERMIT2(address _PERMIT2, address _token, address _spender) public onlyGov{
        IAllowanceTransfer.TokenSpenderPair[] memory tokenSpenderPairs = new IAllowanceTransfer.TokenSpenderPair[](1);
        tokenSpenderPairs[0] = IAllowanceTransfer.TokenSpenderPair(_token, _spender);
        IAllowanceTransfer(_PERMIT2).lockdown(tokenSpenderPairs);
    }

    // Scheduled Time Trigger
    function scheduledTrigger() external onlyWhiteList {

        storageT.distributePlatformFee();

        if((stakePexReward >= rewardRouter.pexStakingVar().minNewRewardAmount)
            && (stakePexReward >= rewardRouter.esPEXStakingVar().minNewRewardAmount)){
            
            rewardRouter.rewardSettlement(stakePexReward);
            emit ScheduledTriggered(msg.sender, stakePexReward);

            previousStakePexReward = stakePexReward;
            delete stakePexReward;
        } else {
            emit ScheduledTriggered(msg.sender, 0);
        }
    }

    // Random Time Trigger
    function randomTrigger(uint _pexBuyMinAmount, uint24 _pexBuyFee) external onlyWhiteList {

        storageT.distributePlatformFee();

        // buyBack
        if(stakePlpReward >= minPexBuyBackAmount){
            bool isSender = true;
            uint24 fee = _pexBuyFee;
            bytes memory path = abi.encodePacked(usdt,fee,pex);
            bytes memory packed = abi.encode(address(1), stakePlpReward, _pexBuyMinAmount, path, isSender);
            bytes[] memory inputs = new bytes[](1);
            inputs[0]=packed;
            bytes memory b = hex"00";
            universalRouter.execute(b,inputs);

            previousStakePlpReward = stakePlpReward;
            emit RandomBuyBack(msg.sender, stakePlpReward);
            delete stakePlpReward;
        } else {
            emit RandomBuyBack(msg.sender, 0);
        }

        // swap esPex
        uint pexAmount;
        uint esPexAmount;
        pexAmount = pex.balanceOf(address(this));
        if(pexAmount > 0){
            esPEX.convert2EsPEX(address(this) ,pexAmount);
        }
        esPexAmount = esPEX.balanceOf(address(this));

        // reward
        if(esPexAmount >= plpStaking.PLPStakingVar().minNewRewardAmount) {
            plpStaking.rewardSettlement(esPexAmount);
            emit RandomRewardPlp(msg.sender, pexAmount, esPexAmount);
        } else {
            emit RandomRewardPlp(msg.sender, 0, 0);
        }
    }

    // distribute ecosystem funds
    function receiveEcosystemFees(uint amount) external onlyStorageT{
        require(checkEcoDistributeP(floorPriceP, stakePexRewardP, stakePlpRewardP, tradeMiningP), "SHARES_PERCENT_WRONG");
        require(amount > 0, "ECO_FEE_0");
        
        usdt.safeTransferFrom(address(storageT), address(this), amount);

        uint ecoTotalP = storageT.ecosystemFeeP();
        floorPriceFund += amount.mulDiv(floorPriceP, ecoTotalP);
        stakePexReward += amount.mulDiv(stakePexRewardP, ecoTotalP);
        stakePlpReward += amount.mulDiv(stakePlpRewardP, ecoTotalP);
        tradeMiningFund += amount.mulDiv(tradeMiningP, ecoTotalP);
    }

    // utils
    function checkEcoDistributeP(
        uint _floorPriceP,
        uint _stakePexRewardP,
        uint _stakePlpRewardP,
        uint _tradeMiningP
    ) private view returns(bool){
        uint ecoTotalP = storageT.ecosystemFeeP();
        return _floorPriceP + _stakePexRewardP + _stakePlpRewardP + _tradeMiningP == ecoTotalP;
    }
}