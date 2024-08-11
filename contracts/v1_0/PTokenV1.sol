// SPDX-License-Identifier: MIT
import '@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol';
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";
import '../interfaces/IPToken.sol';
import "../interfaces/IStorageT.sol";

pragma solidity 0.8.17;

contract PTokenV1 is ERC20Upgradeable, IPToken {
    using MathUpgradeable for uint;

    // Contracts & Addresses (adjustable)
    IERC20 public usdt;
    IStorageT public storageT;

    address public callback;

    // Parameters (constant)
    uint constant PRECISION = 1e6;  // acc values & price

    // LP
    address public FeeduPnlAddress;
    uint public LockDuration;
    uint public MinDeposit;
    uint public MinWithdraw;
    uint8 Decimals;
    uint applyId;

    // LP function
    struct RequestApplyDeposit {
        address sender;
        uint usdtAmount;
        address receiver;
    }

    mapping(uint => RequestApplyDeposit) public RequestIdDeposit;

    struct RequestApplyWithdraw {
        address sender;
        uint plpAmount;
        address receiver;
    }

    mapping(uint => RequestApplyWithdraw) public RequestIdWithdraw;

    struct Lock {
        address sender;
        uint assets;
        uint timestamp;
    }
    uint public LockId;
    mapping(bytes32 => Lock) public LockInfo;
    mapping(address => DoubleEndedQueue.Bytes32Deque) public AddressLocks;

    struct AlreadyApplyRequestId {
        uint deposit;
        uint withdraw;
    }
    mapping(address => AlreadyApplyRequestId) public AddressAlreadyApply;


    uint public totalSend;
    uint public totalReceive;

    //plp staking address
    address public plpStaking;

    // LP event
    event ApplyDeposit(uint);
    event ApplyWithdraw(uint);

    // Events
    event AddressParamUpdated(string name, address newValue);
    event NumberParamUpdated(string name, uint newValue);

    event AssetsSent(address indexed sender, address indexed receiver, uint assets);
    event AssetsReceived(address indexed sender, address indexed user, uint assets);

    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );

    function initialize(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _asset,
        address _callback,
        address _storageT,
        address _feednPnlAddress
    ) external initializer{
        require(
            _feednPnlAddress != address(0)
            && _callback != address(0)
            && _asset != address(0)
            && _storageT != address(0)
        );

        __ERC20_init(_name, _symbol);

        callback = _callback;
        storageT = IStorageT(_storageT);
        FeeduPnlAddress = _feednPnlAddress;
        Decimals = _decimals;
        usdt = IERC20(_asset);
        LockDuration = 60 * 60 * 24 * 3;
        applyId = 1;
        LockId = 1;

        MinDeposit = 10 * PRECISION;
        MinWithdraw = 10 * PRECISION;
    }

    modifier isUpnlFeeder() {
        require(_msgSender() == FeeduPnlAddress, "not feed address");
        _;
    }
    modifier onlyGov(){
        require(msg.sender == storageT.gov(), "GOV_ONLY");
        _;
    }

    function updatePnlHandler(address newValue) external onlyGov {
        require(newValue != address(0), "ADDRESS_0");
        callback = newValue;
        emit AddressParamUpdated("callback", newValue);
    }

    function updateLockDuration(uint newValue) external onlyGov {
        LockDuration = newValue;
        emit NumberParamUpdated("LockDuration", newValue);
    }

    function updateMinDeposit(uint newValue) external onlyGov {
        MinDeposit = newValue;
        emit NumberParamUpdated("MinDeposit", newValue);
    }

    function updateMinWithdraw(uint newValue) external onlyGov {
        MinWithdraw = newValue;
        emit NumberParamUpdated("MinWithdraw", newValue);
    }

    function updateFeednPnlAddress(address newValue) external onlyGov {
        FeeduPnlAddress = newValue;
        emit AddressParamUpdated("FeednPnlAddress", newValue);
    }

    function updatePlpStakingAddress(address newValue) external onlyGov {
        plpStaking = newValue;
        emit AddressParamUpdated("plpStaking", plpStaking);
    }

    function decimals() public view override returns (uint8) {
        return Decimals;
    }

    function convertToPlp(uint usdtAmount, int uPnl) public view returns (uint) {
        if (usdtAmount == type(uint).max && uPnl >= int(PRECISION)) {
            return usdtAmount;
        }

        if (totalSupply() == 0) {
            return usdtAmount;
        }

        require(int(totalAssets()) - uPnl > 0, "convert err");
        uint assetSub = uint(int(totalAssets()) - uPnl);
        return usdtAmount.mulDiv(totalSupply(), assetSub, MathUpgradeable.Rounding.Down);
    }

    function convertToUsdt(uint plpAmount, int uPnl) public view returns (uint) {
        if (plpAmount == type(uint).max && uPnl >= int(PRECISION)) {
            return plpAmount;
        }

        if (totalSupply() == 0) {
            return plpAmount;
        }

        require(int(totalAssets()) - uPnl > 0, "convert err");
        uint assetSub = uint(int(totalAssets()) - uPnl);
        return plpAmount.mulDiv(assetSub, totalSupply(), MathUpgradeable.Rounding.Down);
    }

    function cancelApply(uint requestId) public{
        if(RequestIdDeposit[requestId].usdtAmount!=0 && RequestIdDeposit[requestId].sender!=address(0)){
            require(_msgSender()==RequestIdDeposit[requestId].sender,"can not cancel");
            delete RequestIdDeposit[requestId];
            AddressAlreadyApply[_msgSender()].deposit = 0;
            return;
        }else if(RequestIdWithdraw[requestId].plpAmount!=0 && RequestIdWithdraw[requestId].sender!=address(0)){
            require(_msgSender()==RequestIdWithdraw[requestId].sender,"can not cancel");
            delete RequestIdWithdraw[requestId];
            AddressAlreadyApply[_msgSender()].withdraw = 0;
            return;
        }

        revert("request not found");
    }

    function applyDeposit(
        uint usdtAmount,
        address receiver
    ) external {
        require(usdtAmount <= usdt.balanceOf(_msgSender()), "usdt amount not enough");
        require(usdtAmount >= MinDeposit, "usdt amount to small");
        require(usdt.allowance(msg.sender, address(this)) >= usdtAmount, "please approve");
        require(AddressAlreadyApply[_msgSender()].deposit == 0,"only one apply is allowed");

        uint requestId = applyId++;
        RequestIdDeposit[requestId] = RequestApplyDeposit(_msgSender(), usdtAmount, receiver);
        AddressAlreadyApply[_msgSender()].deposit=uint(requestId);

        emit ApplyDeposit(requestId);
    }

    function runDeposit(uint requestId, int uPnl,uint uPnlLastId) external isUpnlFeeder returns (uint){
        require(uPnlLastId == storageT.getUpnlLastId(),"uPnl verify failed");
        RequestApplyDeposit memory applyDepositData = RequestIdDeposit[requestId];

        require(usdt.allowance(applyDepositData.sender, address(this)) >= applyDepositData.usdtAmount, "please approve");
        require(applyDepositData.sender != address(0) && applyDepositData.usdtAmount != 0, "request id not found");
        require(applyDepositData.usdtAmount <= usdt.balanceOf(applyDepositData.sender), "usdt amount not enough");
        uint plpAmount = convertToPlp(applyDepositData.usdtAmount, uPnl);

        bytes32 LockByte32 = bytes32(LockId++);
        LockInfo[LockByte32]=Lock(applyDepositData.receiver, plpAmount, block.timestamp);
        DoubleEndedQueue.pushBack(AddressLocks[applyDepositData.receiver],LockByte32);

        delete RequestIdDeposit[requestId];
        AddressAlreadyApply[applyDepositData.sender].deposit=0;

        _deposit(applyDepositData.sender, applyDepositData.receiver, applyDepositData.usdtAmount, plpAmount);
        return plpAmount;
    }

    function GetLockSum(address sender) public view returns(uint,uint){
        uint sum = 0;
        uint lockIndex = DoubleEndedQueue.length(AddressLocks[sender]);
        if(lockIndex == 0){
            return (0,0);
        }
        for (int i = int(lockIndex) - 1; i>=0; i--) {
            Lock memory lock = LockInfo[DoubleEndedQueue.at(AddressLocks[sender],uint(i))];
            if (lock.timestamp + LockDuration > block.timestamp) {
                sum += lock.assets;
                lockIndex = uint(i);
            }else{
                break;
            }
        }

        return (sum,lockIndex);
    }

    function updateLock(address sender) private returns(uint){
        (uint lockLum,uint lockIndex) = GetLockSum(sender);
        require(lockIndex <= DoubleEndedQueue.length(AddressLocks[sender]), "lockIndex err");

        for (uint i=0; i < lockIndex; i++) {
            delete LockInfo[DoubleEndedQueue.popFront(AddressLocks[sender])];
        }
        return lockLum;
    }

    function applyWithdraw(
        uint plpAmount,
        address receiver
    ) external {
        require(plpAmount <= balanceOf(_msgSender()), "plp amount not enough");
        require(plpAmount >= MinWithdraw, "plpAmount amount to small");
        require(AddressAlreadyApply[_msgSender()].withdraw == 0,"only one apply is allowed");

        (uint lockSum,)= GetLockSum(_msgSender());
        require(balanceOf(_msgSender()) >= plpAmount + lockSum, "insufficient unlocked");

        uint requestId = applyId++;
        RequestIdWithdraw[requestId] = RequestApplyWithdraw(_msgSender(),plpAmount,receiver);
        AddressAlreadyApply[_msgSender()].withdraw = requestId;

        emit ApplyWithdraw(requestId);
    }

    function runWithdraw(uint requestId, int uPnl,uint uPnlLastId) external isUpnlFeeder returns (uint){
        require(uPnlLastId == storageT.getUpnlLastId(),"uPnl verify failed");
        RequestApplyWithdraw memory applyWithdrawData = RequestIdWithdraw[requestId];

        require(applyWithdrawData.sender != address(0) && applyWithdrawData.plpAmount != 0, "request id not found");
        require(applyWithdrawData.plpAmount <= balanceOf(applyWithdrawData.sender), "assets amount not enough");
        uint usdtAmount = convertToUsdt(applyWithdrawData.plpAmount, uPnl);
        require(usdtAmount <= totalAssets(), "usdt not enough");

        uint lockSum = updateLock(applyWithdrawData.sender);
        require(balanceOf(applyWithdrawData.sender) >= applyWithdrawData.plpAmount + lockSum,"insufficient unlocked");

        delete RequestIdWithdraw[requestId];
        AddressAlreadyApply[applyWithdrawData.sender].withdraw=0;

        _withdraw(applyWithdrawData.sender, applyWithdrawData.receiver, applyWithdrawData.sender, usdtAmount, applyWithdrawData.plpAmount);
        return usdtAmount;
    }

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal virtual {
        // If _asset is ERC777, `transferFrom` can trigger a reenterancy BEFORE the transfer happens through the
        // `tokensToSend` hook. On the other hand, the `tokenReceived` hook, that is triggered after the transfer,
        // calls the vault, which is assumed not malicious.
        //
        // Conclusion: we need to do the transfer before we mint so that any reentrancy would happen before the
        // assets are transferred and before the shares are minted, which is a valid state.
        // slither-disable-next-line reentrancy-no-eth
        SafeERC20.safeTransferFrom(usdt, caller, address(this), assets);
        _mint(receiver, shares);

        emit Deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        // If _asset is ERC777, `transfer` can trigger a reentrancy AFTER the transfer happens through the
        // `tokensReceived` hook. On the other hand, the `tokensToSend` hook, that is triggered before the transfer,
        // calls the vault, which is assumed not malicious.
        //
        // Conclusion: we need to do the transfer after the burn so that any reentrancy would happen after the
        // shares are burned and after the assets are transferred, which is a valid state.
        _burn(owner, shares);
        SafeERC20.safeTransfer(usdt, receiver, assets);

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    function transfer(address to, uint256 amount)public virtual override returns (bool){
        uint lockSum = updateLock(_msgSender());
        require(balanceOf(_msgSender()) >= amount + lockSum,"insufficient unlocked");

        address owner = _msgSender();
        _transfer(owner, to, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    )public virtual override returns (bool){
        address spender = _msgSender();

        if(spender != plpStaking) {
            uint lockSum = updateLock(from);
            require(balanceOf(from) >= amount + lockSum,"insufficient unlocked");
        }

        _spendAllowance(from, spender, amount);
        _transfer(from, to, amount);
        return true;
    }

    // PnL interactions (happens often, so also used to trigger other actions)
    function sendAssets(uint assets, address receiver) external {
        address sender = _msgSender();
        require(sender == callback, "ONLY_TRADING_PNL_HANDLER");

        totalSend += assets;
        SafeERC20.safeTransfer(usdt, receiver, assets);

        emit AssetsSent(sender, receiver, assets);
    }

    function receiveAssets(uint assets, address user) external {
        address sender = _msgSender();
        require(sender == callback || sender == address(storageT), "ONLY_TRADING_PNL_HANDLER");

        totalReceive+=assets;
        SafeERC20.safeTransferFrom(usdt, sender, address(this), assets);
        emit AssetsReceived(sender, user, assets);
    }

    function totalAssets() public view returns (uint){
        return usdt.balanceOf(address(this));
    }

    // To be compatible with old pairs storage contract v1 (to be used only with gUSDT vault)
    function currentBalanceUsdt() external view returns (uint){// 1e18
        return totalAssets();
    }
}