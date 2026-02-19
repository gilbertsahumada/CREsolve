// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title IReceiver
 * @notice Interface for CRE workflow report receivers.
 *         Contracts that receive reports from the KeystoneForwarder must implement this.
 */
interface IReceiver is IERC165 {
    /**
     * @notice Called by the KeystoneForwarder when a DON-signed report is available
     * @param metadata CRE metadata (workflow ID, DON ID, signer info, etc.)
     * @param report ABI-encoded payload produced by the workflow
     */
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
