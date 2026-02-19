// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IReceiver} from "./IReceiver.sol";

/**
 * @title ReceiverTemplate
 * @notice Base contract for receiving CRE workflow reports via the KeystoneForwarder.
 *         Validates the forwarder, decodes metadata, and delegates to `_processReport()`.
 *
 *         Follows the Chainlink CRE receiver pattern:
 *         1. Only the authorized forwarder may call `onReport()`
 *         2. Metadata is decoded to extract workflow identity (workflowId, donId, etc.)
 *         3. Optional workflow identity checks can restrict which workflows are accepted
 *         4. The raw report bytes are passed to `_processReport()` for application logic
 *
 * @dev Inherit this contract and override `_processReport(bytes calldata report)`.
 */
abstract contract ReceiverTemplate is IReceiver, Ownable {
    // ─── Structs ──────────────────────────────────────────────────────

    struct WorkflowIdentity {
        bytes32 workflowId;
        bytes32 workflowOwner;
        bytes32 donId;
    }

    struct AllowedWorkflow {
        bool isAllowed;
        string name;
    }

    // ─── State ────────────────────────────────────────────────────────

    /// @notice Address of the KeystoneForwarder that delivers reports
    address public forwarder;

    /// @notice Registry of allowed workflow identities (composite key → AllowedWorkflow)
    mapping(bytes32 => AllowedWorkflow) private _allowedWorkflows;

    /// @notice When true, only registered workflow identities are accepted
    bool public enforceWorkflowIdentity;

    // ─── Events ───────────────────────────────────────────────────────

    event ForwarderUpdated(address indexed oldForwarder, address indexed newForwarder);
    event WorkflowAllowed(bytes32 indexed workflowId, bytes32 indexed donId, string name);
    event WorkflowDisallowed(bytes32 indexed workflowId, bytes32 indexed donId);
    event ReportProcessed(bytes32 indexed workflowId, bytes32 indexed donId);

    // ─── Errors ───────────────────────────────────────────────────────

    error UnauthorizedForwarder(address caller);
    error UnauthorizedWorkflow(bytes32 workflowId, bytes32 donId);
    error MetadataTooShort(uint256 length);

    // ─── Constructor ──────────────────────────────────────────────────

    /**
     * @param _forwarder Address of the KeystoneForwarder
     */
    constructor(address _forwarder) Ownable(msg.sender) {
        forwarder = _forwarder;
    }

    // ─── IReceiver Implementation ─────────────────────────────────────

    /**
     * @notice Entry point called by the KeystoneForwarder
     * @param metadata Encoded workflow metadata (workflowId, donId, signers, etc.)
     * @param report Raw report bytes from the workflow
     */
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        // 1. Validate caller is the authorized forwarder
        if (msg.sender != forwarder) {
            revert UnauthorizedForwarder(msg.sender);
        }

        // 2. Decode and validate metadata
        WorkflowIdentity memory identity = _decodeMetadata(metadata);

        // 3. Check workflow identity if enforcement is enabled
        if (enforceWorkflowIdentity) {
            bytes32 key = _workflowKey(identity.workflowId, identity.donId);
            if (!_allowedWorkflows[key].isAllowed) {
                revert UnauthorizedWorkflow(identity.workflowId, identity.donId);
            }
        }

        // 4. Delegate to application logic
        _processReport(report);

        emit ReportProcessed(identity.workflowId, identity.donId);
    }

    // ─── ERC165 ───────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // ─── Admin Functions ──────────────────────────────────────────────

    /**
     * @notice Update the forwarder address
     * @param _newForwarder The new forwarder address
     */
    function setForwarder(address _newForwarder) external onlyOwner {
        address old = forwarder;
        forwarder = _newForwarder;
        emit ForwarderUpdated(old, _newForwarder);
    }

    /**
     * @notice Allow a specific workflow identity to submit reports
     * @param workflowId The workflow ID
     * @param donId The DON ID
     * @param name Human-readable name for the workflow
     */
    function allowWorkflow(bytes32 workflowId, bytes32 donId, string calldata name) external onlyOwner {
        bytes32 key = _workflowKey(workflowId, donId);
        _allowedWorkflows[key] = AllowedWorkflow({isAllowed: true, name: name});
        emit WorkflowAllowed(workflowId, donId, name);
    }

    /**
     * @notice Disallow a workflow identity
     * @param workflowId The workflow ID
     * @param donId The DON ID
     */
    function disallowWorkflow(bytes32 workflowId, bytes32 donId) external onlyOwner {
        bytes32 key = _workflowKey(workflowId, donId);
        delete _allowedWorkflows[key];
        emit WorkflowDisallowed(workflowId, donId);
    }

    /**
     * @notice Toggle workflow identity enforcement
     * @param enforce Whether to enforce workflow identity checks
     */
    function setEnforceWorkflowIdentity(bool enforce) external onlyOwner {
        enforceWorkflowIdentity = enforce;
    }

    // ─── View Functions ───────────────────────────────────────────────

    /**
     * @notice Check if a workflow identity is allowed
     * @param workflowId The workflow ID
     * @param donId The DON ID
     * @return isAllowed Whether the workflow is allowed
     * @return name The workflow name
     */
    function isWorkflowAllowed(bytes32 workflowId, bytes32 donId) external view returns (bool isAllowed, string memory name) {
        bytes32 key = _workflowKey(workflowId, donId);
        AllowedWorkflow storage wf = _allowedWorkflows[key];
        return (wf.isAllowed, wf.name);
    }

    // ─── Internal Functions ───────────────────────────────────────────

    /**
     * @notice Override this function to implement application-specific report processing
     * @param report The raw report bytes to process
     */
    function _processReport(bytes calldata report) internal virtual;

    /**
     * @notice Decode CRE metadata from the forwarder
     * @param metadata Raw metadata bytes
     * @return identity The decoded workflow identity
     */
    function _decodeMetadata(bytes calldata metadata) internal pure returns (WorkflowIdentity memory identity) {
        // CRE metadata layout: workflowId (32 bytes) + donId (32 bytes) + ...
        // Minimum 64 bytes for workflowId + donId
        if (metadata.length < 64) {
            revert MetadataTooShort(metadata.length);
        }

        identity.workflowId = bytes32(metadata[:32]);
        identity.donId = bytes32(metadata[32:64]);

        // workflowOwner would be at metadata[64:96] if present
        if (metadata.length >= 96) {
            identity.workflowOwner = bytes32(metadata[64:96]);
        }
    }

    /**
     * @notice Compute a composite key for workflow identity lookup
     */
    function _workflowKey(bytes32 workflowId, bytes32 donId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(workflowId, donId));
    }
}
