// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface IRewardsDistributor {
    function resolveAndDistribute(
        address studio,
        uint64 epoch,
        address[] calldata workers,
        uint256[] calldata weights,
        uint8[] calldata dimScores,
        bool resolution
    ) external;
}

/**
 * @title CREReceiver
 * @notice Receives DON-signed reports from KeystoneForwarder and forwards
 *         resolution data to RewardsDistributor.resolveAndDistribute()
 * @dev Deploy this, then call rewardsDistributor.setAuthorizedResolver(address(this), true)
 *
 * @author CREsolver
 */
contract CREReceiver is IReceiver, Ownable {
    IRewardsDistributor public immutable rewardsDistributor;
    address public keystoneForwarder;

    event ReportReceived(bytes32 indexed workflowId, address indexed studio, uint64 epoch);
    event ForwarderUpdated(address indexed oldForwarder, address indexed newForwarder);

    error UnauthorizedForwarder(address caller);

    constructor(
        address _rewardsDistributor,
        address _keystoneForwarder
    ) Ownable(msg.sender) {
        rewardsDistributor = IRewardsDistributor(_rewardsDistributor);
        keystoneForwarder = _keystoneForwarder;
    }

    /**
     * @notice Update the KeystoneForwarder address
     * @param _newForwarder The new forwarder address
     */
    function setKeystoneForwarder(address _newForwarder) external onlyOwner {
        address old = keystoneForwarder;
        keystoneForwarder = _newForwarder;
        emit ForwarderUpdated(old, _newForwarder);
    }

    /**
     * @notice Called by KeystoneForwarder with a DON-signed report
     * @param metadata CRE metadata (workflow ID, DON ID, etc.)
     * @param report ABI-encoded resolution payload
     */
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != keystoneForwarder) {
            revert UnauthorizedForwarder(msg.sender);
        }

        // Decode the resolution payload (Option 4: blinded weights)
        (
            address studio,
            uint64 epoch,
            address[] memory workers,
            uint256[] memory weights,
            uint8[] memory dimScores,
            bool resolution
        ) = abi.decode(report, (address, uint64, address[], uint256[], uint8[], bool));

        // Forward to RewardsDistributor
        rewardsDistributor.resolveAndDistribute(
            studio,
            epoch,
            workers,
            weights,
            dimScores,
            resolution
        );

        // Extract workflow ID from metadata for logging
        bytes32 workflowId;
        if (metadata.length >= 32) {
            workflowId = bytes32(metadata[:32]);
        }

        emit ReportReceived(workflowId, studio, epoch);
    }
}
