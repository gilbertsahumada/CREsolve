// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./interfaces/ReceiverTemplate.sol";

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
 * @notice Receives DON-signed reports from the KeystoneForwarder via ReceiverTemplate
 *         and forwards resolution data to CREsolverMarket.resolveMarket()
 * @dev Deploy this, then call market.setAuthorizedResolver(address(this), true)
 *
 * @author CREsolver
 */
contract CREReceiver is ReceiverTemplate {
    ICREsolverMarket public market;

    event ReportReceived(bytes32 indexed workflowId, uint256 indexed marketId);
    event MarketUpdated(address indexed oldMarket, address indexed newMarket);

    constructor(
        address _market,
        address _forwarder
    ) ReceiverTemplate(_forwarder) {
        require(_market != address(0), "Invalid market address");
        market = ICREsolverMarket(_market);
    }

    /**
     * @notice Update the CREsolverMarket address (avoids redeploying CREReceiver)
     * @param _newMarket The new CREsolverMarket address
     */
    function setMarket(address _newMarket) external onlyOwner {
        require(_newMarket != address(0), "Invalid market address");
        address old = address(market);
        market = ICREsolverMarket(_newMarket);
        emit MarketUpdated(old, _newMarket);
    }

    /**
     * @notice Process a DON-signed resolution report
     * @param report ABI-encoded resolution payload:
     *        (uint256 marketId, address[] workers, uint256[] weights, uint8[] dimScores, bool resolution)
     */
    function _processReport(bytes calldata report) internal override {
        (
            uint256 marketId,
            address[] memory workers,
            uint256[] memory weights,
            uint8[] memory dimScores,
            bool resolution
        ) = abi.decode(report, (uint256, address[], uint256[], uint8[], bool));

        market.resolveMarket(marketId, workers, weights, dimScores, resolution);

        // workflowId is available from metadata decoding in parent, but _processReport
        // only receives the report. We emit with bytes32(0) for the workflowId here;
        // the parent already emits ReportProcessed with the actual identity.
        emit ReportReceived(bytes32(0), marketId);
    }
}
