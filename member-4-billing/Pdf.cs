using System.Globalization;
using System.Text;

namespace Billing;

public static class Pdf
{
    public static byte[] Render(State invoice)
    {
        static string Escape(string s) => s.Replace("\\", "\\\\").Replace("(", "\\(").Replace(")", "\\)");
        var text = $"BT /F1 16 Tf 50 760 Td (LOCAL SANDBOX - NOT A TAX INVOICE) Tj 0 -40 Td /F1 12 Tf ({Escape(invoice.Id)}) Tj 0 -25 Td ({Escape(invoice.Currency)} {(invoice.Amount / 100m).ToString("F2", CultureInfo.InvariantCulture)}) Tj 0 -25 Td ({Escape(invoice.Status)}) Tj ET";
        string[] objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", $"<< /Length {Encoding.ASCII.GetByteCount(text)} >>\nstream\n{text}\nendstream"];
        var builder = new StringBuilder("%PDF-1.4\n"); var offsets = new List<int> { 0 }; for (int i = 0; i < objects.Length; i++) { offsets.Add(Encoding.ASCII.GetByteCount(builder.ToString())); builder.Append($"{i + 1} 0 obj\n{objects[i]}\nendobj\n"); }
        int xref = Encoding.ASCII.GetByteCount(builder.ToString()); builder.Append($"xref\n0 {objects.Length + 1}\n0000000000 65535 f \n"); foreach (var o in offsets.Skip(1)) builder.Append(o.ToString("D10") + " 00000 n \n"); builder.Append($"trailer\n<< /Size {objects.Length + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"); return Encoding.ASCII.GetBytes(builder.ToString());
    }
}
