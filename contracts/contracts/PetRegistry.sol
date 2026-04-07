// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PetRegistry
 * @dev Single contract MVP for PetID Web3 - Pet recovery protocol on Syscoin NEVM
 * @notice Handles pet registration, lost mode, sighting reports, and rewards
 */
contract PetRegistry is ERC721Enumerable, Ownable, ReentrancyGuard {
    
    // ============ Enums ============
    
    enum PetStatus { SAFE, LOST, FOUND }
    enum ReportStatus { PENDING, ACCEPTED, REJECTED }
    
    // ============ Structs ============
    
    struct Pet {
        string name;
        string animalType;      // "dog", "cat", etc.
        string metadataURI;     // IPFS or HTTPS URL for photos/details
        PetStatus status;
        uint256 rewardWei;      // Bounty for finding
        string approxArea;      // Approximate location (city/neighborhood)
        uint64 createdAt;
        uint64 updatedAt;
        uint32 reportCount;
    }
    
    struct Sighting {
        uint256 petId;
        address reporter;
        string approxArea;      // Where the pet was seen
        string noteURI;         // Optional note/photo URI
        uint256 stakeWei;       // Anti-spam stake
        ReportStatus status;
        uint64 createdAt;
    }

    enum GeneralReportType { LOST, FOUND, SIGHTING, ABANDONED }

    struct GeneralReport {
        address reporter;
        GeneralReportType reportType;
        string metadataURI;     // IPFS/HTTPS URI with full details
        string zone;            // Approximate area
        uint64 createdAt;
    }
    
    // ============ State Variables ============
    
    uint256 private _nextTokenId;
    uint256 private _nextReportId;
    uint256 private _nextGeneralReportId;
    
    /// @notice Minimum stake required to report a sighting (anti-spam)
    uint256 public constant MIN_STAKE = 0.001 ether; // 0.001 SYS
    
    /// @notice Mapping from token ID to Pet data
    mapping(uint256 => Pet) public pets;
    
    /// @notice Mapping from report ID to Sighting data
    mapping(uint256 => Sighting) public sightings;
    
    /// @notice Mapping from pet ID to array of report IDs
    mapping(uint256 => uint256[]) public petReports;

    /// @notice Mapping from general report ID to GeneralReport data
    mapping(uint256 => GeneralReport) public generalReports;

    /// @notice Mapping from reporter to their general report IDs
    mapping(address => uint256[]) public reporterGeneralReports;
    
    /// @notice Treasury for burned stakes (rejected reports)
    address public treasury;
    
    // ============ Events ============
    
    event PetRegistered(
        uint256 indexed petId,
        address indexed owner,
        string name,
        string animalType,
        string metadataURI
    );
    
    event PetMetadataUpdated(
        uint256 indexed petId,
        string metadataURI
    );
    
    event LostModeSet(
        uint256 indexed petId,
        bool active,
        uint256 rewardWei,
        string approxArea
    );
    
    event SightingReported(
        uint256 indexed petId,
        uint256 indexed reportId,
        address indexed reporter,
        string approxArea,
        uint256 stakeWei
    );
    
    event CaseResolved(
        uint256 indexed petId,
        uint256 indexed reportId,
        bool accepted
    );
    
    event RewardClaimed(
        uint256 indexed petId,
        uint256 indexed reportId,
        address indexed reporter,
        uint256 amountWei
    );
    
    event StakeReturned(
        uint256 indexed reportId,
        address indexed reporter,
        uint256 amountWei
    );
    
    event StakeBurned(
        uint256 indexed reportId,
        uint256 amountWei
    );

    event GeneralReportCreated(
        uint256 indexed reportId,
        address indexed reporter,
        GeneralReportType reportType,
        string zone
    );
    
    // ============ Errors ============
    
    error NotPetOwner();
    error PetNotLost();
    error PetAlreadyLost();
    error InsufficientStake();
    error ReportNotFound();
    error ReportNotPending();
    error ReportNotAccepted();
    error NotReporter();
    error RewardAlreadyClaimed();
    error TransferFailed();
    error InvalidPetId();
    error EmptyZone();
    
    // ============ Constructor ============
    
    constructor(
        address initialOwner,
        address _treasury,
        string memory tokenName,
        string memory tokenSymbol
    )
        ERC721(tokenName, tokenSymbol)
        Ownable(initialOwner)
    {
        treasury = _treasury;
        _nextTokenId = 1;
        _nextReportId = 1;
        _nextGeneralReportId = 1;
    }
    
    // ============ Pet Registration ============
    
    /**
     * @notice Register a new pet and mint NFT passport
     * @param name Pet's name
     * @param animalType Type of animal (dog, cat, etc.)
     * @param metadataURI URI to pet metadata (photo, details)
     * @return petId The ID of the newly registered pet
     */
    function registerPet(
        string calldata name,
        string calldata animalType,
        string calldata metadataURI
    ) external returns (uint256 petId) {
        petId = _nextTokenId++;
        
        pets[petId] = Pet({
            name: name,
            animalType: animalType,
            metadataURI: metadataURI,
            status: PetStatus.SAFE,
            rewardWei: 0,
            approxArea: "",
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp),
            reportCount: 0
        });
        
        _safeMint(msg.sender, petId);
        
        emit PetRegistered(petId, msg.sender, name, animalType, metadataURI);
    }
    
    /**
     * @notice Update pet metadata URI
     * @param petId The pet's token ID
     * @param metadataURI New metadata URI
     */
    function updatePetMetadata(uint256 petId, string calldata metadataURI) external {
        if (ownerOf(petId) != msg.sender) revert NotPetOwner();
        
        pets[petId].metadataURI = metadataURI;
        pets[petId].updatedAt = uint64(block.timestamp);
        
        emit PetMetadataUpdated(petId, metadataURI);
    }
    
    // ============ Lost Mode ============
    
    /**
     * @notice Toggle lost mode for a pet
     * @param petId The pet's token ID
     * @param lost Whether to activate or deactivate lost mode
     * @param approxArea Approximate area where pet was last seen
     */
    function setLostMode(
        uint256 petId,
        bool lost,
        string calldata approxArea
    ) external payable {
        if (ownerOf(petId) != msg.sender) revert NotPetOwner();
        
        Pet storage pet = pets[petId];
        
        if (lost) {
            if (pet.status == PetStatus.LOST) revert PetAlreadyLost();
            pet.status = PetStatus.LOST;
            pet.rewardWei = msg.value; // Reward is the ETH sent with tx
            pet.approxArea = approxArea;
        } else {
            pet.status = PetStatus.SAFE;
            // Refund remaining reward if deactivating
            if (pet.rewardWei > 0) {
                uint256 refund = pet.rewardWei;
                pet.rewardWei = 0;
                (bool success, ) = msg.sender.call{value: refund}("");
                if (!success) revert TransferFailed();
            }
        }
        
        pet.updatedAt = uint64(block.timestamp);
        
        emit LostModeSet(petId, lost, pet.rewardWei, approxArea);
    }
    
    /**
     * @notice Add more reward to a lost pet
     * @param petId The pet's token ID
     */
    function addReward(uint256 petId) external payable {
        if (ownerOf(petId) != msg.sender) revert NotPetOwner();
        if (pets[petId].status != PetStatus.LOST) revert PetNotLost();
        
        pets[petId].rewardWei += msg.value;
        pets[petId].updatedAt = uint64(block.timestamp);
        
        emit LostModeSet(petId, true, pets[petId].rewardWei, pets[petId].approxArea);
    }
    
    // ============ Sighting Reports ============
    
    /**
     * @notice Report a sighting of a lost pet
     * @param petId The pet's token ID
     * @param approxArea Approximate area where pet was seen
     * @param noteURI Optional URI to notes/photos
     * @return reportId The ID of the new report
     */
    function reportSighting(
        uint256 petId,
        string calldata approxArea,
        string calldata noteURI
    ) external payable returns (uint256 reportId) {
        if (pets[petId].createdAt == 0) revert InvalidPetId();
        if (pets[petId].status != PetStatus.LOST) revert PetNotLost();
        if (msg.value < MIN_STAKE) revert InsufficientStake();
        
        reportId = _nextReportId++;
        
        sightings[reportId] = Sighting({
            petId: petId,
            reporter: msg.sender,
            approxArea: approxArea,
            noteURI: noteURI,
            stakeWei: msg.value,
            status: ReportStatus.PENDING,
            createdAt: uint64(block.timestamp)
        });
        
        petReports[petId].push(reportId);
        pets[petId].reportCount++;
        
        emit SightingReported(petId, reportId, msg.sender, approxArea, msg.value);
    }
    
    // ============ General Reports (no registered pet) ============

    /**
     * @notice Create a general report not tied to a registered pet
     * @param reportType Type of report (LOST, FOUND, SIGHTING, ABANDONED)
     * @param metadataURI URI with report details (photo, description, etc.)
     * @param zone Approximate area
     * @return reportId The ID of the new general report
     */
    function createGeneralReport(
        GeneralReportType reportType,
        string calldata metadataURI,
        string calldata zone
    ) external returns (uint256 reportId) {
        if (bytes(zone).length == 0) revert EmptyZone();

        reportId = _nextGeneralReportId++;

        generalReports[reportId] = GeneralReport({
            reporter: msg.sender,
            reportType: reportType,
            metadataURI: metadataURI,
            zone: zone,
            createdAt: uint64(block.timestamp)
        });

        reporterGeneralReports[msg.sender].push(reportId);

        emit GeneralReportCreated(reportId, msg.sender, reportType, zone);
    }

    // ============ Case Resolution ============
    
    /**
     * @notice Resolve a sighting report (accept or reject)
     * @param petId The pet's token ID
     * @param reportId The report ID to resolve
     * @param accept Whether to accept or reject the report
     */
    function resolveCase(
        uint256 petId,
        uint256 reportId,
        bool accept
    ) external nonReentrant {
        if (ownerOf(petId) != msg.sender) revert NotPetOwner();
        
        Sighting storage report = sightings[reportId];
        if (report.petId != petId) revert ReportNotFound();
        if (report.status != ReportStatus.PENDING) revert ReportNotPending();
        
        if (accept) {
            report.status = ReportStatus.ACCEPTED;
            pets[petId].status = PetStatus.FOUND;
            
            // Return stake to reporter
            if (report.stakeWei > 0) {
                uint256 stake = report.stakeWei;
                (bool success, ) = report.reporter.call{value: stake}("");
                if (!success) revert TransferFailed();
                emit StakeReturned(reportId, report.reporter, stake);
            }
        } else {
            report.status = ReportStatus.REJECTED;
            
            // Burn stake (send to treasury)
            if (report.stakeWei > 0) {
                uint256 stake = report.stakeWei;
                (bool success, ) = treasury.call{value: stake}("");
                if (!success) revert TransferFailed();
                emit StakeBurned(reportId, stake);
            }
        }
        
        emit CaseResolved(petId, reportId, accept);
    }
    
    /**
     * @notice Claim reward for an accepted report
     * @param petId The pet's token ID
     * @param reportId The accepted report ID
     */
    function claimReward(uint256 petId, uint256 reportId) external nonReentrant {
        Sighting storage report = sightings[reportId];
        
        if (report.petId != petId) revert ReportNotFound();
        if (report.status != ReportStatus.ACCEPTED) revert ReportNotAccepted();
        if (report.reporter != msg.sender) revert NotReporter();
        
        Pet storage pet = pets[petId];
        uint256 reward = pet.rewardWei;
        
        if (reward == 0) revert RewardAlreadyClaimed();
        
        pet.rewardWei = 0;
        
        (bool success, ) = msg.sender.call{value: reward}("");
        if (!success) revert TransferFailed();
        
        emit RewardClaimed(petId, reportId, msg.sender, reward);
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Get pet details
     * @param petId The pet's token ID
     */
    function getPet(uint256 petId) external view returns (
        address owner,
        string memory name,
        string memory animalType,
        string memory metadataURI,
        PetStatus status,
        uint256 rewardWei,
        string memory approxArea,
        uint64 createdAt,
        uint64 updatedAt,
        uint32 reportCount
    ) {
        if (pets[petId].createdAt == 0) revert InvalidPetId();
        
        Pet storage pet = pets[petId];
        return (
            ownerOf(petId),
            pet.name,
            pet.animalType,
            pet.metadataURI,
            pet.status,
            pet.rewardWei,
            pet.approxArea,
            pet.createdAt,
            pet.updatedAt,
            pet.reportCount
        );
    }
    
    /**
     * @notice Get all report IDs for a pet
     * @param petId The pet's token ID
     */
    function getPetReportIds(uint256 petId) external view returns (uint256[] memory) {
        return petReports[petId];
    }
    
    /**
     * @notice Get sighting details
     * @param reportId The report ID
     */
    function getSighting(uint256 reportId) external view returns (
        uint256 petId,
        address reporter,
        string memory approxArea,
        string memory noteURI,
        uint256 stakeWei,
        ReportStatus status,
        uint64 createdAt
    ) {
        Sighting storage report = sightings[reportId];
        return (
            report.petId,
            report.reporter,
            report.approxArea,
            report.noteURI,
            report.stakeWei,
            report.status,
            report.createdAt
        );
    }
    
    /**
     * @notice Get total number of registered pets
     */
    function totalPets() external view returns (uint256) {
        return _nextTokenId - 1;
    }
    
    /**
     * @notice Get total number of reports
     */
    function totalReports() external view returns (uint256) {
        return _nextReportId - 1;
    }

    /**
     * @notice Get total number of general reports
     */
    function totalGeneralReports() external view returns (uint256) {
        return _nextGeneralReportId - 1;
    }

    /**
     * @notice Get general report details
     * @param reportId The general report ID
     */
    function getGeneralReport(uint256 reportId) external view returns (
        address reporter,
        GeneralReportType reportType,
        string memory metadataURI,
        string memory zone,
        uint64 createdAt
    ) {
        GeneralReport storage r = generalReports[reportId];
        require(r.createdAt != 0, "Report not found");
        return (r.reporter, r.reportType, r.metadataURI, r.zone, r.createdAt);
    }

    /**
     * @notice Get general report IDs by reporter
     * @param reporter Address of the reporter
     */
    function getGeneralReportsByReporter(address reporter) external view returns (uint256[] memory) {
        return reporterGeneralReports[reporter];
    }
    
    /**
     * @notice Get all pets owned by an address
     * @param owner Address to query
     */
    function getPetsByOwner(address owner) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory result = new uint256[](balance);
        
        for (uint256 i = 0; i < balance; i++) {
            result[i] = tokenOfOwnerByIndex(owner, i);
        }
        
        return result;
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Update treasury address
     * @param newTreasury New treasury address
     */
    function setTreasury(address newTreasury) external onlyOwner {
        treasury = newTreasury;
    }
    
    /**
     * @notice Emergency withdraw (only owner)
     */
    function emergencyWithdraw() external onlyOwner {
        (bool success, ) = owner().call{value: address(this).balance}("");
        if (!success) revert TransferFailed();
    }
    
    // ============ Required Overrides ============
    
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }
    
    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }
    
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
    
    // ============ Receive ETH ============
    
    receive() external payable {}
}
