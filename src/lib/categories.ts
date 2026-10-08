import { BedDouble, Bus, Footprints, Shapes, Sofa, Utensils, type LucideIcon } from "lucide-react";
import type { Category } from "./types";

interface CategoryMeta {
  label: string;
  icon: LucideIcon;
  /** Classes do selo (fundo claro + texto com contraste AA) */
  chip: string;
  /** Cor sólida usada em pontos do mapa e da linha do tempo */
  color: string;
}

export const categories: Record<Category, CategoryMeta> = {
  passeio: {
    label: "Passeio",
    icon: Footprints,
    chip: "bg-forest-100 text-forest-700",
    color: "#2A5F52",
  },
  alimentacao: {
    label: "Alimentação",
    icon: Utensils,
    chip: "bg-coral-100 text-coral-700",
    color: "#E0603F",
  },
  transporte: {
    label: "Transporte",
    icon: Bus,
    chip: "bg-[#E4ECF6] text-[#294C78]",
    color: "#3B6AA8",
  },
  descanso: {
    label: "Descanso",
    icon: Sofa,
    chip: "bg-[#EEE8F6] text-[#563C82]",
    color: "#7C5CBF",
  },
  hospedagem: {
    label: "Hospedagem",
    icon: BedDouble,
    chip: "bg-[#F8EED8] text-[#6E4E10]",
    color: "#B98318",
  },
  outros: {
    label: "Outros",
    icon: Shapes,
    chip: "bg-[#ECE9E4] text-[#4A4540]",
    color: "#7A7268",
  },
};

export const categoryOrder: Category[] = [
  "passeio",
  "alimentacao",
  "transporte",
  "descanso",
  "hospedagem",
  "outros",
];
