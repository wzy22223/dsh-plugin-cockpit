import { BarChart3, Boxes, Globe, PackageOpen, Truck } from "lucide-react";

export interface WD {
  data_date: string;
  generated_at: string;
  modules: {
    shipment?: SM;
    returns?: RM;
    inventory?: IM;
    brief?: BM;
    platforms?: PM;
    regions?: RM2;
  };
}

export interface SM {
  date: string;
  summary: Record<string, number | string>;
  by_style: SS[];
}
export interface SS {
  style: string;
  skus?: { sku: string; 昨日实发: number; 可用数: number }[];
  "昨日实发": number;
  "昨日销量": number;
  月实发: number;
  可用数: number;
}

export interface RM {
  date: string;
  summary: Record<string, number | string>;
  by_style: RS[];
}
export interface RS {
  style: string;
  "昨日退货量": number;
  "月退货量": number;
  "销退在途": number;
  "退货原因"?: Record<string, number>;
}

export interface TM {
  note?: string;
  daily: TD[];
  weekly: TW[];
  date_count: number;
}
export interface TD {
  date: string;
  实发: number;
  退货: number;
  仅退款: number;
  库存: number;
}
export interface TW {
  week: string;
  实发: number;
  退货: number;
  仅退款: number;
}

export interface IM {
  date: string;
  summary: Record<string, number | string>;
  alerts: {
    缺货: II[];
    低库存: II[];
    超卖: II[];
    快需补货: II[];
    滞销_180天: II[];
    滞销_90天: II[];
    滞销_60天: II[];
    滞销_30天: II[];
  };
}
export interface II {
  sku: string;
  product: string;
  可用数: number;
  可售天数: number;
  采购在途: number;
  日均销量?: number;
  日均退货?: number;
  标记?: string;
  周转天数?: string;
  订单占有?: string;
  月销量?: number;
  月退货量?: number;
  可销天数?: number;
  补货标签?: string;
}

export interface BM {
  headline: string;
  attention: string[];
}
export interface PM {
  summary: Record<string, number | string>;
  by_platform: PI[];
}
export interface PI {
  platform: string;
  订单数: number;
}
export interface RM2 {
  summary: Record<string, number | string>;
  by_province: RI[];
}
export interface RI {
  province: string;
  订单数: number;
  top_cities: { city: string; count: number }[];
}

export type TabKey = "shipment" | "returns" | "inventory" | "brief" | "platforms";

export const TABS: {
  key: TabKey;
  label: string;
  hint: string;
  icon: typeof BarChart3;
}[] = [
  { key: "brief", label: "经营简报", hint: "简报总览", icon: BarChart3 },
  { key: "shipment", label: "发货分析", hint: "款式与明细", icon: Truck },
  { key: "returns", label: "退货分析", hint: "原因与明细", icon: PackageOpen },
  { key: "inventory", label: "库存分析", hint: "预警与补货", icon: Boxes },
  { key: "platforms", label: "平台分析", hint: "平台与地域", icon: Globe },
];
