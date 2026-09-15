import { PACKS } from "@/data/packs";
import { Storefront } from "@/components/Storefront";

export default function HomePage() {
  return <Storefront packs={PACKS} />;
}
