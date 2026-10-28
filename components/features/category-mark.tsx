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
      <Icon
        aria-hidden="true"
        size={14}
        style={{ color: String(category?.color || "#a1a1aa") }}
      />
      <span>{String(category?.name || "")}</span>
    </span>
  );
}
