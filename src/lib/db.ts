import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  image?: string;
  prepTime: number;
  category: string;
  extras: { name: string; price: number }[];
  createdAt: number;
  customOrder: number;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  prepTime: number;
  instructions: string;
  extras: { name: string; price: number; quantity: number }[];
  discount?: { type: 'flat' | 'percent'; value: number };
}

export interface Order {
  id: string;
  orderNo: number;
  tableNo?: string;
  items: OrderItem[];
  status: 'active' | 'to-bill' | 'completed';
  timestamp: number;
  customTime?: number;
  overallInstructions: string;
  servedTimestamp?: number;
  isPaid?: boolean;
}

export interface Bill {
  id: string;
  orderId: string;
  orderNo: number;
  items: OrderItem[];
  subtotal: number;
  discount: { type: 'flat' | 'percent'; value: number };
  taxPercent: number;
  total: number;
  isSold: boolean;
  timestamp: number;
  customFields: Record<string, string>;
}

export interface Settings {
  id: 'current';
  accentColor: string;
  bgColor: string;
  lightBgColor: string;
  borderRadius: number;
  theme: 'dark' | 'light';
  companyLogo?: string;
  billHeader: string;
  billFooter: string;
  defaultTax: number;
  notificationThreshold: number;
  billingAlertThreshold: number;
  billingRepeatInterval: number;
  enableBillingAlerts: boolean;
  customBillFields: string[];
  menuSortMethod: 'alphabetical' | 'category' | 'recent' | 'custom';
  menuSortDirection: 'asc' | 'desc';
}

interface InigmaDB extends DBSchema {
  menu: { key: string; value: MenuItem };
  orders: { key: string; value: Order; indexes: { 'by-status': string } };
  bills: { key: string; value: Bill; indexes: { 'by-timestamp': number } };
  settings: { key: string; value: Settings };
}

let dbPromise: Promise<IDBPDatabase<InigmaDB>>;

export const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<InigmaDB>('inigma-pos', 1, {
      upgrade(db) {
        db.createObjectStore('menu', { keyPath: 'id' });
        const orderStore = db.createObjectStore('orders', { keyPath: 'id' });
        orderStore.createIndex('by-status', 'status');
        const billStore = db.createObjectStore('bills', { keyPath: 'id' });
        billStore.createIndex('by-timestamp', 'timestamp');
        db.createObjectStore('settings', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
};

export const defaultSettings: Settings = {
  id: 'current',
  accentColor: '#ff5300',
  bgColor: '#0a0a0a',
  lightBgColor: '#ffffff',
  borderRadius: 20,
  theme: 'dark',
  billHeader: 'INIGMA POS',
  billFooter: 'Thank you for your visit!',
  defaultTax: 0,
  notificationThreshold: 20,
  billingAlertThreshold: 10,
  billingRepeatInterval: 5,
  enableBillingAlerts: true,
  customBillFields: [],
  menuSortMethod: 'custom',
  menuSortDirection: 'asc',
};
