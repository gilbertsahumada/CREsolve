// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface ICREsolverMarket {
    function resolveMarket(
        uint256 marketId,
        address[] calldata workers,
        uint256[] calldata weights,
        uint8[] calldata dimScores,
        bool resolution
    ) external;
}

/**
 * @title CREReceiver
 * @notice Receives DON-signed reports from KeystoneForwarder and forwards
 *         resolution data to CREsolverMarket.resolveMarket()
 * @dev Deploy this, then call market.setAuthorizedResolver(address(this), true)
 *
 * @author CREsolver
 */
contract CREReceiver is IReceiver, Ownable {
    ICREsolverMarket public immutable market;
    address public keystoneForwarder;

    event ReportReceived(bytes32 indexed workflowId, uint256 indexed marketId);
    event ForwarderUpdated(address indexed oldForwarder, address indexed newForwarder);

    error UnauthorizedForwarder(address caller);

    constructor(
        address _market,
        address _keystoneForwarder
    ) Ownable(msg.sender) {
        market = ICREsolverMarket(_market);
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

        // Decode the resolution payload
        (
            uint256 marketId,
            address[] memory workers,
            uint256[] memory weights,
            uint8[] memory dimScores,
            bool resolution
        ) = abi.decode(report, (uint256, address[], uint256[], uint8[], bool));

        // Forward to CREsolverMarket
        market.resolveMarket(marketId, workers, weights, dimScores, resolution);

        // Extract workflow ID from metadata for logging
        bytes32 workflowId;
        if (metadata.length >= 32) {
            workflowId = bytes32(metadata[:32]);
        }

        emit ReportReceived(workflowId, marketId);
    }
}
