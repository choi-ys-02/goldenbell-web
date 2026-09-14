declare module "qrcode" {
  type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

  type SvgOptions = {
    color?: {
      dark?: string;
      light?: string;
    };
    errorCorrectionLevel?: ErrorCorrectionLevel;
    margin?: number;
    type: "svg";
    width?: number;
  };

  const QRCode: {
    toString(text: string, options: SvgOptions): Promise<string>;
  };

  export default QRCode;
}
