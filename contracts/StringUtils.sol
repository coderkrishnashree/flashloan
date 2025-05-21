// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

library StringUtils {
    function addressToString(address _addr) internal pure returns (string memory) {
        bytes32 value = bytes32(uint256(_addr));
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = '0';
        str[1] = 'x';
        for (uint256 i = 0; i < 20; i++) {
            str[2+i*2] = alphabet[uint8(value[i + 12] >> 4)];
            str[3+i*2] = alphabet[uint8(value[i + 12] & 0x0f)];
        }
        return string(str);
    }
    
    function uintToString(uint256 _value) internal pure returns (string memory) {
        if (_value == 0) {
            return "0";
        }
        uint256 temp = _value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (_value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(_value % 10)));
            _value /= 10;
        }
        return string(buffer);
    }
    
    // Add a helper function to concatenate strings
    function concat(string memory a, string memory b) internal pure returns (string memory) {
        return string(abi.encodePacked(a, b));
    }
    
    // Add more helpers for common concatenation patterns
    function concatAddressInfo(string memory prefix, address addr, string memory suffix) internal pure returns (string memory) {
        return string(abi.encodePacked(prefix, addressToString(addr), suffix));
    }
    
    function concatUintInfo(string memory prefix, uint256 value, string memory suffix) internal pure returns (string memory) {
        return string(abi.encodePacked(prefix, uintToString(value), suffix));
    }
}