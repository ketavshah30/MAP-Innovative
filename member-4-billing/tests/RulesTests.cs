using Billing;
using Xunit;

public class RulesTests {
    [Fact] public void LateSuccessRequiresRefund(){Assert.Equal("REFUND_PENDING",Rules.ResultStatus("CANCELLED","SUCCEEDED"));}
    [Fact] public void StaleFailureCannotRevokeSuccess(){Assert.Equal("ACTIVE",Rules.ResultStatus("ACTIVE","FAILED"));}
    [Fact] public void LateFailureCannotForgetCancellation(){Assert.Equal("CANCELLED",Rules.ResultStatus("CANCELLED","FAILED"));Assert.Equal("REFUND_PENDING",Rules.ResultStatus("REFUND_PENDING","FAILED"));}
    [Fact] public void IdempotencyRejectsChangedPayload(){Rules.SameRequest("same","same");Assert.Throws<Problem>(()=>Rules.SameRequest("first","second"));}
    [Fact] public void PdfHasConsistentCrossReference(){var data=Pdf.Render(new State{Id="test",Amount=19900});var text=System.Text.Encoding.ASCII.GetString(data);Assert.StartsWith("%PDF-1.4",text);var position=int.Parse(text.Split("startxref\n")[1].Split('\n')[0]);Assert.StartsWith("xref",text[position..]);}
}
