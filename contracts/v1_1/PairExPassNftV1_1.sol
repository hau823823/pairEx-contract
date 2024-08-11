// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import '../interfaces/IStorageT.sol';

contract PairExPassNftV1_1 is Ownable, Pausable, ERC1155, ERC1155Supply {
    using SafeERC20 for IERC20;

    // usdt
    IERC20 public usdt;
    IStorageT public storageT;

    // nft params
    uint256 public userCanMintAmount;

    mapping(uint => uint) public monthTimeStamps;
    mapping(uint => uint) public monthSupplyAmounts;
    mapping(uint => uint) public monthMintPrices; // 1e6

    // address already mint
    mapping(address => mapping(uint => uint)) public userAlreadyMintAmount;

    // event
    event URIUpdated(string uri);
    event USDTUpdated(address _token);
    event TimeStampUpdated(uint id, uint value);
    event MonthPriceUpdated(uint id, uint value);
    event MonthAmountUpdated(uint id, uint value);
    event UserCanMintAmountUpdated(uint value);
    event FeeAddrUpdated(address _addr);

    constructor(
        address _usdtAddr,
        address _storageT
    ) ERC1155("") {
        require(_usdtAddr != address(0), "USDT ADDRESS IS NIL");
        require(_storageT != address(0), "STORAGET ADDRESS IS NIL");

        usdt = IERC20(_usdtAddr);
        storageT = IStorageT(_storageT);

        userCanMintAmount = 1;
    }

    // Modifiers
    modifier notContract(){
        require(tx.origin == msg.sender);
        _;
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    // set params
    function setURI(string memory newuri) external onlyOwner {
        _setURI(newuri);

        emit URIUpdated(newuri);
    }

    // set every month start timestamp
    function setMonthTimeStamp(uint256 tokenId, uint timeStamp) public onlyOwner {
        require(isValidTokenId(tokenId), "INVALID_TOKENID");
        require (timeStamp > 0, "TIMESTAMP_0");
        monthTimeStamps[tokenId] = timeStamp;

        emit TimeStampUpdated(tokenId, timeStamp);
    }

    function setMonthTimeStampsArray(uint256[] calldata tokenIds, uint256[] calldata timeStamps) external onlyOwner {
        require(tokenIds.length == timeStamps.length, "WRONG_PARAMS");

        for(uint i = 0; i < tokenIds.length; i++){
            setMonthTimeStamp(tokenIds[i], timeStamps[i]);
        }
    }

    function setMonthPrice(uint256 tokenId, uint256 price) public onlyOwner {
        require(isValidTokenId(tokenId), "INVALID_TOKENID");
        monthMintPrices[tokenId] = price;

        emit MonthPriceUpdated(tokenId, price);
    }

    function setMonthPricesArray(uint256[] calldata tokenIds, uint[] calldata prices) external onlyOwner {
        require(tokenIds.length == prices.length, "WRONG_PARAMS");

        for(uint i = 0; i < tokenIds.length; i++){
            setMonthPrice(tokenIds[i], prices[i]);
        }
    }

    function setMonthAmount(uint256 tokenId, uint256 amount) public onlyOwner {
        require(isValidTokenId(tokenId), "INVALID_TOKENID");
        require(amount > 0, "MOMTH_AMOUNT_0");
        monthSupplyAmounts[tokenId] = amount;

        emit MonthAmountUpdated(tokenId, amount);
    }

    function setMonthAmountsArrary(uint256[] calldata tokenIds, uint[] calldata amounts) external onlyOwner {
        require(tokenIds.length == amounts.length, "WRONG_PARAMS");

        for(uint i = 0; i < tokenIds.length; i++){
            setMonthAmount(tokenIds[i], amounts[i]);
        }
    }

    function setUserCanMintAmount(uint _amount) external onlyOwner {
        require(_amount > 0, "USER_CANNT_MINT");

        userCanMintAmount = _amount;

        emit UserCanMintAmountUpdated(_amount);
    }

    function updateSupportedPayment(address _token) external onlyOwner {
        require(_token != address(0));

        usdt = IERC20(_token);

        emit USDTUpdated(_token);
    }

    function updateStorageTAddress(address _addr) external onlyOwner {
        require(_addr != address(0), "ADDRESS IS NIL");

        storageT = IStorageT(_addr);

        emit FeeAddrUpdated(_addr);
    }

    // main function
    function isMintable(uint256 tokenId) public view returns(bool){
        if(!isValidTokenId(tokenId)) {
            return false;
        }

        uint256 startTokenId = getStartTimeTokenId(tokenId, 1);
        uint256 endTokenId = getEndTimeTokenId(tokenId, 1);

        if(!isTokenIdExist(startTokenId) || !isTokenIdExist(endTokenId)){
            return false;
        }

        uint256 startTime = monthTimeStamps[startTokenId];
        uint256 endTime = monthTimeStamps[endTokenId];
        uint256 currentTime = block.timestamp;
        
        bool withinTimeRange = currentTime >= startTime && currentTime < endTime;
        bool amountAvailable = totalSupply(tokenId) < monthSupplyAmounts[tokenId];

        return withinTimeRange && amountAvailable;
    }

    function isUsable(uint256 tokenId) public view returns(bool){
        if(!isValidTokenId(tokenId)) {
            return false;
        }

        uint256 endTokenId = getEndTimeTokenId(tokenId, 1);

        if(!isTokenIdExist(tokenId) || !isTokenIdExist(endTokenId)){
            return false;
        }

        uint256 startTime = monthTimeStamps[tokenId];
        uint256 endTime = monthTimeStamps[endTokenId];
        uint256 currentTime = block.timestamp;
        
        return currentTime >= startTime && currentTime < endTime;
    }

    function isExpired(uint256 tokenId) public view returns(bool){
        if(!isValidTokenId(tokenId)) {
            return true;
        }

        uint256 endTokenId = getEndTimeTokenId(tokenId, 1);

        if(!isTokenIdExist(tokenId) || !isTokenIdExist(endTokenId)){
            return true;
        }

        uint256 currentTime = block.timestamp;
        uint256 endTime = monthTimeStamps[endTokenId];

        return currentTime >= endTime;
    }

    function mint(uint256 id, uint256 amount) public notContract whenNotPaused {
        address account = msg.sender;

        require(isValidTokenId(id), "INVALID_TOKENID");
        require(isMintable(id), "NOT_MINTABLE");
        require(userAlreadyMintAmount[account][id] + amount <= userCanMintAmount, "EXCEED_MINT_AMOUNT");
        require(usdt.balanceOf(account) >= monthMintPrices[id] * amount, "USDT_AMOUNT_NOT_ENOUGH");
        require(usdt.allowance(account, address(storageT)) >= monthMintPrices[id] * amount, "USDT_ALLOWANCE_NOT_ENOUGH");
        
        userAlreadyMintAmount[account][id] += amount;

        if(monthMintPrices[id] > 0) {
            storageT.handlePlatFormFeeFromNft(account, monthMintPrices[id] * amount);
        }

        _mint(account, id, amount, "");
    }

    // utils function
    function isTokenIdExist(uint256 tokenId) public view returns (bool) {
        return (monthTimeStamps[tokenId] != 0 && monthSupplyAmounts[tokenId] != 0);
    }

    function isValidTokenId(uint256 tokenId) public pure returns (bool) {
        uint8 year = uint8(tokenId / 100);
        uint8 month = uint8(tokenId % 100);

        
        if (year >= 23 && year <= 99 && month >= 1 && month <= 12) {
            return true;
        } else {
            return false;
        }
    }

    function getEndTimeTokenId(uint256 tokenId, uint8 gap) private pure returns (uint256) {
        require(isValidTokenId(tokenId), "INVALID_TOKENID");
        require(gap <= 12, "GAP_LARGER_12");

        uint8 year = uint8(tokenId / 100);
        uint8 month = uint8(tokenId % 100);

        uint8 nextMonth = month + gap;
        uint8 nextYear = year;

        if (nextMonth > 12) {
            nextMonth = nextMonth - 12;
            nextYear = year + 1;
        }

        uint256 nextTokenId = uint256(nextYear) * 100 + nextMonth;

        return nextTokenId;
    }

    function getStartTimeTokenId(uint256 tokenId, uint8 gap) private pure returns (uint256) {
        require(isValidTokenId(tokenId), "INVALID_TOKENID");
        require(gap <= 12, "GAP_LARGER_12");

        uint8 year = uint8(tokenId / 100);
        uint8 month = uint8(tokenId % 100);

        uint8 previousYear = year;
        uint8 previousMonth;

        if(month <= gap) {
            previousMonth = gap - month;
            previousMonth = 12 - previousMonth;
            previousYear = previousYear - 1;
        } else {
            previousMonth = month - gap;
        }

        uint256 previousTokenId = uint256(previousYear) * 100 + previousMonth;

        return previousTokenId;
    }

    // overide
    function balanceOf(address account, uint256 tokenId) 
        public 
        view 
        override(ERC1155) returns (uint256) 
    {
        if (isExpired(tokenId)) {
            return 0;
        }
        return super.balanceOf(account, tokenId);
    }

    function balanceOfBatch(address[] memory accounts, uint256[] memory tokenId) 
        public
        view 
        override(ERC1155)  returns (uint256[] memory) 
    {
        require(accounts.length == tokenId.length, "ERC1155: accounts and ids length mismatch");

        uint256[] memory batchBalances = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; ++i) {
            if (isExpired(tokenId[i])) {
                batchBalances[i] = 0;
            } else {
                batchBalances[i] = super.balanceOf(accounts[i], tokenId[i]);
            }
        }

        return batchBalances;
    }

    function uri(uint256 _tokenid) public view override returns (string memory) {
        string memory baseuri = super.uri(_tokenid);

        return string(
            abi.encodePacked(
                baseuri,
                Strings.toString(_tokenid),".json"
            )
        );
    }

    function _beforeTokenTransfer(address operator, address from, address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
        internal
        whenNotPaused
        override(ERC1155, ERC1155Supply)
    {
        for (uint256 i = 0; i < ids.length; ++i) {
            require(!isExpired(ids[i]), "NFT_EXPIRED");
        }

        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
    }
}