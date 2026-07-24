import logoAsset from "@/assets/q-salon-logo.png.asset.json";

type LogoProps = {
  className?: string;
  size?: number;
  alt?: string;
};

export function Logo({ className, size = 32, alt = "Q-Salon Suite" }: LogoProps) {
  return (
    <img
      src={logoAsset.url}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}
