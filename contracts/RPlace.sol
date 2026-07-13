// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RPlace
/// @notice Single shared 64x64 pixel canvas. Anyone can paint pixels.
/// @dev Pack layout for paintPixels: [x:8 | y:8 | rgb:24] = 40 bits per update
contract RPlace {
    uint8 public constant WIDTH = 64;
    uint8 public constant HEIGHT = 64;
    uint16 public constant TOTAL = uint16(WIDTH) * uint16(HEIGHT); // 4096
    uint256 public constant MAX_BATCH = 256;

    /// @dev Flat array of rgb values. Index = y * WIDTH + x. 0x000000 = unpainted (white).
    uint24[4096] private _pixels;

    uint64 public version;

    error OutOfBounds(uint8 x, uint8 y);
    error EmptyBatch();
    error BatchTooLarge(uint256 size);

    /// @notice Emitted for every pixel painted — easy to sync from logs.
    event PixelPainted(uint8 indexed x, uint8 indexed y, uint24 rgb, address indexed painter);

    /// @notice Paint one or more pixels. Packed format: [x:8 | y:8 | rgb:24] in low 40 bits.
    function paintPixels(uint40[] calldata packed) external {
        uint256 count = packed.length;
        if (count == 0) revert EmptyBatch();
        if (count > MAX_BATCH) revert BatchTooLarge(count);

        for (uint256 i = 0; i < count; ++i) {
            uint8 x = uint8(packed[i] >> 32);
            uint8 y = uint8(packed[i] >> 24);
            uint24 rgb = uint24(packed[i]);

            if (x >= WIDTH || y >= HEIGHT) revert OutOfBounds(x, y);

            _pixels[uint16(y) * WIDTH + x] = rgb;
            emit PixelPainted(x, y, rgb, msg.sender);
        }

        unchecked { version += 1; }
    }

    /// @notice Returns the full 4096-pixel canvas in one call.
    function getCanvas() external view returns (uint24[4096] memory) {
        return _pixels;
    }

    /// @notice Returns a single pixel's color.
    function getPixel(uint8 x, uint8 y) external view returns (uint24) {
        if (x >= WIDTH || y >= HEIGHT) revert OutOfBounds(x, y);
        return _pixels[uint16(y) * WIDTH + x];
    }
}
