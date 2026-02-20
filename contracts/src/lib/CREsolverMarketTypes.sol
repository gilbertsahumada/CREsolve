// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct Market {
    string question;
    uint256 rewardPool;
    uint256 deadline;
    address creator;
    bool resolved;
}

struct Reputation {
    uint256 resQualitySum;
    uint256 srcQualitySum;
    uint256 analysisDepthSum;
    uint256 count;
}
