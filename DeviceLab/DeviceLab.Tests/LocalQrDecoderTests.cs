using DeviceLab.Scanner;
using ZXing;
using ZXing.Common;

namespace DeviceLab.Tests;

public class LocalQrDecoderTests
{
    [Fact]
    public void DecodesQrFromRgbaPixels()
    {
        const string expected = "DEVICE-LAB-LOCAL-DEMO";
        var matrix = new MultiFormatWriter().encode(expected, BarcodeFormat.QR_CODE, 260, 260);

        var result = LocalQrDecoder.DecodeRgba(ToRgba(matrix), matrix.Width, matrix.Height);

        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(1, 0)]
    [InlineData(481, 1)]
    [InlineData(1, 481)]
    public void RejectsInvalidImageDimensions(int width, int height)
    {
        Assert.Null(LocalQrDecoder.DecodeRgba(Array.Empty<byte>(), width, height));
    }

    [Fact]
    public void ReturnsNullForBlankImage()
    {
        const int size = 220;
        var pixels = new byte[size * size * 4];
        for (var i = 0; i < pixels.Length; i += 4)
        {
            pixels[i] = 255;
            pixels[i + 1] = 255;
            pixels[i + 2] = 255;
            pixels[i + 3] = 255;
        }

        Assert.Null(LocalQrDecoder.DecodeRgba(pixels, size, size));
    }

    private static byte[] ToRgba(BitMatrix matrix)
    {
        var pixels = new byte[matrix.Width * matrix.Height * 4];
        var index = 0;
        for (var y = 0; y < matrix.Height; y++)
        for (var x = 0; x < matrix.Width; x++)
        {
            var value = matrix[x, y] ? (byte)12 : (byte)255;
            pixels[index++] = value;
            pixels[index++] = value;
            pixels[index++] = value;
            pixels[index++] = 255;
        }

        return pixels;
    }
}
