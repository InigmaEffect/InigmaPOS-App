import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return `PKR ${amount.toLocaleString()}`;
}

export function calculateOrderTime(items: any[]) {
  return items.reduce((total, item) => {
    const itemPrep = (item.prepTime || 0) * (item.quantity || 1);
    return total + itemPrep;
  }, 0);
}

export function formatTimeLeft(minutes: number) {
  if (isNaN(minutes) || minutes < 0) return "00:00";
  const totalSeconds = Math.floor(minutes * 60);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function calculateOrderTotal(items: any[]) {
  return items.reduce((sum, item) => {
    const extrasSum = (item.extras || []).reduce((es: number, e: any) => es + (e.price * (e.quantity || 1)), 0);
    const itemSubtotal = (item.price * item.quantity) + extrasSum;
    const discountAmt = item.discount?.type === 'percent' 
      ? (itemSubtotal * (item.discount.value / 100)) 
      : (item.discount?.value || 0);
    return sum + (itemSubtotal - discountAmt);
  }, 0);
}

export function generateOrderNo(count: number = 0) {
  return 1000 + count + 1;
}
