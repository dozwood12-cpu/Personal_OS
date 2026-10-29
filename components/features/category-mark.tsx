import {
  Tag,
  Wallet,
  Briefcase,
  Book,
  Car,
  Coffee,
  Home,
  Star,
  Heart,
  ShoppingBag,
} from "lucide-react";
import type { Row } from "@/lib/model";
const icons = {
  Tag,
  Wallet,
  Briefcase,
  Book,
  Car,
  Coffee,
  Home,
  Star,
  Heart,
  ShoppingBag,
};
export function CategoryMark({ category }: { category?: Row }) {
  const Icon = icons[String(category?.icon) as keyof typeof icons] || Tag;
  return (
    <span className="category-mark">
      <Icon aria-hidden="true" size={14} strokeWidth={1.25} />
      <span>{String(category?.name || "")}</span>
    </span>
  );
}
