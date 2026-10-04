using ZXing;
using ZXing.Common;

namespace DeviceLab.Scanner;

/// <summary>Decodes a bounded RGBA image locally, accepting QR codes only.</summary>
public static class LocalQrDecoder
{
    private static readonly object Gate = new();
    private static readonly BarcodeReaderGeneric Reader = CreateReader();

    public static string? DecodeRgba(byte[]? rgba, int width, int height)
    {
        if (rgba is null || width < 1 || height < 1 || width > 480 || height > 480 || rgba.Length != width * height * 4)
            return null;

        lock (Gate)
        {
            var result = Reader.Decode(rgba, width, height, RGBLuminanceSource.BitmapFormat.RGBA32);
            return result?.BarcodeFormat == BarcodeFormat.QR_CODE ? result.Text : null;
        }
    }

    private static BarcodeReaderGeneric CreateReader()
    {
        var reader = new BarcodeReaderGeneric();
        reader.Options = new DecodingOptions
        {
            TryHarder = true,
            PossibleFormats = new List<BarcodeFormat> { BarcodeFormat.QR_CODE }
        };
        return reader;
    }
}
