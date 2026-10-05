// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title ProofDrop
/// @notice Tiny USDC escrow for proof-backed micro-bounties on Base.
/// @dev v0 deliberately supports one active claimant per bounty. Challenge/proof
///      payloads live offchain; hashes are committed onchain and URIs are emitted.
contract ProofDrop {

    enum Status {
        Open,
        Claimed,
        Paid,
        Cancelled
    }

    struct Drop {
        address creator;
        address claimant;
        uint96 amount;
        uint40 createdAt;
        uint40 claimedAt;
        Status status;
        bytes32 challengeHash;
        bytes32 proofHash;
    }

    error ZeroAmount();
    error ZeroHash();
    error NotCreator();
    error NotClaimant();
    error SelfClaim();
    error WrongStatus();
    error TokenTransferFailed();

    IERC20 public immutable usdc;
    uint256 public nextDropId = 1;
    mapping(uint256 => Drop) public drops;

    uint256 private _locked = 1;

    event DropCreated(
        uint256 indexed dropId,
        address indexed creator,
        uint96 amount,
        bytes32 indexed challengeHash,
        string challengeURI
    );
    event DropClaimed(
        uint256 indexed dropId,
        address indexed claimant,
        bytes32 indexed proofHash,
        string proofURI
    );
    event ClaimWithdrawn(uint256 indexed dropId, address indexed claimant);
    event ClaimRejected(uint256 indexed dropId, address indexed claimant);
    event DropPaid(uint256 indexed dropId, address indexed claimant, uint96 amount);
    event DropCancelled(uint256 indexed dropId, uint96 amount);

    constructor(address usdc_) {
        usdc = IERC20(usdc_);
    }

    modifier nonReentrant() {
        require(_locked == 1, "REENTRANCY");
        _locked = 2;
        _;
        _locked = 1;
    }

    function createDrop(
        uint96 amount,
        bytes32 challengeHash,
        string calldata challengeURI
    ) external nonReentrant returns (uint256 dropId) {
        if (amount == 0) revert ZeroAmount();
        if (challengeHash == bytes32(0)) revert ZeroHash();

        dropId = nextDropId++;
        drops[dropId] = Drop({
            creator: msg.sender,
            claimant: address(0),
            amount: amount,
            createdAt: uint40(block.timestamp),
            claimedAt: 0,
            status: Status.Open,
            challengeHash: challengeHash,
            proofHash: bytes32(0)
        });

        _safeTransferFrom(msg.sender, address(this), amount);
        emit DropCreated(dropId, msg.sender, amount, challengeHash, challengeURI);
    }

    function claim(
        uint256 dropId,
        bytes32 proofHash,
        string calldata proofURI
    ) external {
        Drop storage drop = drops[dropId];
        if (drop.status != Status.Open) revert WrongStatus();
        if (msg.sender == drop.creator) revert SelfClaim();
        if (proofHash == bytes32(0)) revert ZeroHash();

        drop.claimant = msg.sender;
        drop.claimedAt = uint40(block.timestamp);
        drop.status = Status.Claimed;
        drop.proofHash = proofHash;

        emit DropClaimed(dropId, msg.sender, proofHash, proofURI);
    }

    function withdrawClaim(uint256 dropId) external {
        Drop storage drop = drops[dropId];
        if (drop.status != Status.Claimed) revert WrongStatus();
        if (msg.sender != drop.claimant) revert NotClaimant();

        address claimant = drop.claimant;
        _clearClaim(drop);
        emit ClaimWithdrawn(dropId, claimant);
    }

    function rejectClaim(uint256 dropId) external {
        Drop storage drop = drops[dropId];
        if (drop.status != Status.Claimed) revert WrongStatus();
        if (msg.sender != drop.creator) revert NotCreator();

        address claimant = drop.claimant;
        _clearClaim(drop);
        emit ClaimRejected(dropId, claimant);
    }

    function approveAndPay(uint256 dropId) external nonReentrant {
        Drop storage drop = drops[dropId];
        if (drop.status != Status.Claimed) revert WrongStatus();
        if (msg.sender != drop.creator) revert NotCreator();

        address claimant = drop.claimant;
        uint96 amount = drop.amount;
        drop.status = Status.Paid;

        _safeTransfer(claimant, amount);
        emit DropPaid(dropId, claimant, amount);
    }

    function cancel(uint256 dropId) external nonReentrant {
        Drop storage drop = drops[dropId];
        if (drop.status != Status.Open) revert WrongStatus();
        if (msg.sender != drop.creator) revert NotCreator();

        uint96 amount = drop.amount;
        drop.status = Status.Cancelled;

        _safeTransfer(drop.creator, amount);
        emit DropCancelled(dropId, amount);
    }

    function _clearClaim(Drop storage drop) private {
        drop.claimant = address(0);
        drop.claimedAt = 0;
        drop.status = Status.Open;
        drop.proofHash = bytes32(0);
    }

    function _safeTransfer(address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(usdc).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TokenTransferFailed();
        }
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(usdc).call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TokenTransferFailed();
        }
    }
}
