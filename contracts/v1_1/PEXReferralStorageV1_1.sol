// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../interfaces/IReferralStorage.sol";
import "../interfaces/IStorageT.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract PEXReferralStorageV1_1 is IReferralStorage, Initializable {
    IStorageT public storageT;
    IERC20 public usdt;

    struct Tier {
        uint256 totalRebate; // e.g. 2400 for 24%
        uint256 discountShare; // 5000 for 50%/50%, 7000 for 30% rebates/70% discount
    }

    uint256 public constant BASIS_POINTS = 10000;

    uint public MIN_REBATE_CLAIM_THRESHOLD;
    uint public MIN_SAVE_CLAIM_THRESHOLD;
    uint public MAX_CODES_PER_REFERRER;

    mapping(address => uint256) public referrerTiers;
    mapping(uint256 => Tier) public tiers;
    mapping(address => bytes32[]) public ownerCodes;
    mapping(bytes32 => address) public codeOwners;
    mapping(address => bytes32) public traderReferralCodes;

    mapping(address => uint) public referrerCount;

    mapping(address => uint256) public rebate;
    mapping(address => uint256) public save;

    bool public changeCode;

    event RebateClamied(address indexed refer, uint256 amount);
    event SaveClaimed(address indexed trader, uint256 amount);
    event SetTier(uint256 tierId, uint256 totalRebate, uint256 discountShare);
    event SetTraderReferralCode(address account, bytes32 code);
    event SetReferrerTier(address referrer, uint256 tierId);
    event RegisterCode(address account, bytes32 code);
    event SaveCharged(address indexed trader, bytes32 code, uint256 tradeVolume, uint256 amount);
    event RebateCharged(address indexed referer, bytes32 code, uint256 tradeVolume, uint256 amount);

    function initialize(
        IStorageT _storageT
    ) external initializer{
        require(address(_storageT) != address(0), "WRONG_PARAMS");

        storageT = _storageT;
        usdt = storageT.usdt();

        MIN_REBATE_CLAIM_THRESHOLD = 5*1e6;
        MIN_SAVE_CLAIM_THRESHOLD = 5*1e6;
        MAX_CODES_PER_REFERRER = 1;
        changeCode = false;
    }

    modifier onlyGov() {
        require(msg.sender == storageT.gov(), "GOV_ONLY");
        _;
    }

    modifier onlyCallback() {
        require(msg.sender == storageT.callbacks()
            || msg.sender == storageT.adlCallbacks()
            || msg.sender == address(storageT.tradeRegister()), "CALLBACK_ONLY");
        _;
    }

    modifier notContract(){
        require(tx.origin == msg.sender);
        _;
    }

    function setClaimThreshold(uint _rebate, uint _save) external onlyGov {
        MIN_REBATE_CLAIM_THRESHOLD = _rebate;
        MIN_SAVE_CLAIM_THRESHOLD = _save;
    }

    function setMaxCodes(uint val) external onlyGov {
        require(val > 0, "INVALID_MAX_CODE_LIMIT");
        MAX_CODES_PER_REFERRER = val;
    }

    function setChangeCode(bool val) external onlyGov {
        changeCode = val;
    }

    function setTier(
        uint256 _tierId,
        uint256 _totalRebate,
        uint256 _discountShare
    ) external onlyGov {
        require(
            _totalRebate + _discountShare <= BASIS_POINTS,
            "INVALID_REBATE_SUM_SHARE"
        );

        Tier memory tier = tiers[_tierId];
        tier.totalRebate = _totalRebate;
        tier.discountShare = _discountShare;
        tiers[_tierId] = tier;
        emit SetTier(_tierId, _totalRebate, _discountShare);
    }

    function setReferrerTier(
        address _referrer,
        uint256 _tierId
    ) external onlyGov {
        referrerTiers[_referrer] = _tierId;
        emit SetReferrerTier(_referrer, _tierId);
    }

    function setTraderReferralCodeByUser(bytes32 _code) external notContract {
        _setTraderReferralCode(msg.sender, _code);
    }

    function registerCode(bytes32 _code) external notContract {
        require(_code != bytes32(0), "INVALID_CODE");
        require(
            codeOwners[_code] == address(0),
            "CODE_ALREDY_EXIST"
        );
        require(ownerCodes[msg.sender].length < MAX_CODES_PER_REFERRER, "EXCEED_CODE_LIMIT");
        require(_checkCodeFormat(_code), "INVALID_CODE_FORMAT");

        codeOwners[_code] = msg.sender;
        ownerCodes[msg.sender].push(_code);
        emit RegisterCode(msg.sender, _code);
    }

    function getTraderReferralInfo(
        address _account
    ) public view override returns (bytes32, address) {
        bytes32 code = traderReferralCodes[_account];
        address referrer;
        if (code != bytes32(0)) {
            referrer = codeOwners[code];
        }
        return (code, referrer);
    }

    function _setTraderReferralCode(address _account, bytes32 _code) private {
        address owner = codeOwners[_code];
        require(owner != address(0), "INVALID_CODE");
        require(_account != owner, "SELF_REFERAL_FORBIDEN");

        (, address traderRefferAddr) = getTraderReferralInfo(owner);
        require(traderRefferAddr != _account, "CIRCLE_REFERRAL_FORBIDEN");

        (, traderRefferAddr) = getTraderReferralInfo(_account);
        if (traderRefferAddr != address(0)) {
            require(changeCode, "CHANGE_CODE_NOT_ALLOWED");
            referrerCount[traderRefferAddr] -= 1;
        }

        referrerCount[codeOwners[_code]] += 1;
        traderReferralCodes[_account] = _code;
        emit SetTraderReferralCode(_account, _code);
    }

    function _addReferrerRebate(address refer, uint256 amount) private {
        rebate[refer] += amount;
        return;
    }

    function _addTraderSave(address trader, uint256 amount) private {
        save[trader] += amount;
        return;
    }

    function distributeReferralAndSaveFee(
        address trader,
        uint256 tradeVolume,
        uint256 fee
    ) external onlyCallback returns (uint256) {
        (bytes32 code, address referrer) = getTraderReferralInfo(trader);
        if (referrer == address(0)) {
            return 0;
        }

        Tier memory t = tiers[referrerTiers[referrer]];
        uint256 r = (fee * t.totalRebate) / BASIS_POINTS;
        uint256 s = (fee * t.discountShare) / BASIS_POINTS;
        _addReferrerRebate(referrer, r);
        _addTraderSave(trader, s);

        emit RebateCharged(referrer, code, tradeVolume, r);
        emit SaveCharged(trader, code, tradeVolume, s);

        return r + s;
    }

    function claimRebate() external notContract {
        uint256 amount = rebate[msg.sender];
        require(amount > MIN_REBATE_CLAIM_THRESHOLD, "NO_AVAIL_REBATE_CLAIM");
        storageT.transferUsdt(address(storageT), msg.sender, amount);
        rebate[msg.sender] -= amount;
        emit RebateClamied(msg.sender, amount);
    }

    function claimSave() external notContract {
        uint256 amount = save[msg.sender];
        require(amount > MIN_SAVE_CLAIM_THRESHOLD, "NO_AVAIL_SAVE_CLAIM");
        storageT.transferUsdt(address(storageT), msg.sender, amount);
        save[msg.sender] -= amount;
        emit SaveClaimed(msg.sender, amount);
    }

    // The code length is less than 10 and consists of numbers and English characters
    function _checkCodeFormat(bytes32 _code) private pure returns (bool) {
        string memory str = bytes32ToString(_code);
        bytes memory b = bytes(str);
        if (b.length > 10) {
            return false;
        }
        for (uint i = 0; i < b.length; i++) {
            bytes1 char = b[i];
            if (!(char >= 0x30 && char <= 0x39) && // 0-9
            !(char >= 0x41 && char <= 0x5A) && // A-Z
            !(char >= 0x61 && char <= 0x7A))   // a-z
                return false;
        }
        return true;
    }

    // covert bytes32 to string
    function bytes32ToString(bytes32 _bytes32) private pure returns (string memory) {
        uint8 i = 0;
        while(i < 32 && _bytes32[i] != 0) {
            i++;
        }
        bytes memory bytesArray = new bytes(i);
        for (uint8 j = 0; j < i; j++) {
            bytesArray[j] = _bytes32[j];
        }
        return string(bytesArray);
    }
}
