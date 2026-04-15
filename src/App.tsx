import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Home, 
  ClipboardList, 
  Receipt, 
  UtensilsCrossed, 
  Settings as SettingsIcon,
  Plus,
  Search,
  Trash2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  Image as ImageIcon,
  X,
  Download,
  Filter,
  ArrowLeft,
  Bell,
  ArrowUpAZ,
  ArrowDownAZ,
  ArrowUpZA,
  ArrowDownZA,
  GripVertical,
  ArrowUpDown
} from 'lucide-react';
import { 
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getDB, defaultSettings, MenuItem, Order, Bill, Settings, OrderItem } from './lib/db';
import { cn, formatCurrency, calculateOrderTime, generateOrderNo, formatTimeLeft, calculateOrderTotal } from './lib/utils';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// --- Components ---

const BottomNav = ({ activeTab, navigateTo, counts }: { activeTab: string, navigateTo: (t: string) => void, counts: any }) => {
  const tabs = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'orders', label: 'Orders', icon: ClipboardList, badge: counts.orders },
    { id: 'bills', label: 'Bills', icon: Receipt },
    { id: 'menu', label: 'Menu', icon: UtensilsCrossed },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4">
      <div className="max-w-md mx-auto bg-black/60 blur-overlay border border-white/10 rounded-[24px] p-1.5 flex justify-between items-center shadow-2xl">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => navigateTo(tab.id)}
              className={cn(
                "relative flex-1 flex flex-col items-center py-2 rounded-2xl transition-all duration-300",
                isActive ? "text-accent bg-accent/10" : "text-white/40 hover:text-white/60"
              )}
            >
              <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[8px] font-bold uppercase tracking-widest mt-1">{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="absolute top-1.5 right-1.5 bg-accent text-white text-[8px] font-bold min-w-[14px] h-[14px] flex items-center justify-center rounded-full border border-bg-dark">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

const Modal = ({ isOpen, onClose, title, children, fullScreen = false }: any) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 blur-overlay"
          />
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className={cn(
              "relative w-full bg-bg-dark border-t border-white/10 rounded-t-[32px] overflow-hidden flex flex-col",
              fullScreen ? "h-[95vh]" : "max-h-[85vh]"
            )}
          >
            <div className="flex items-center justify-between p-6 border-b border-white/5">
              <h2 className="text-xl font-bold tracking-tight">{title}</h2>
              <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 pb-12">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [history, setHistory] = useState<string[]>(['home']);
  
  // Modals
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [billingOrder, setBillingOrder] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  // Order Creation State
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [overallInstructions, setOverallInstructions] = useState('');
  const [customOrderTime, setCustomOrderTime] = useState<number | ''>('');
  const [tableNo, setTableNo] = useState('');

  const [toast, setToast] = useState<{ message: string; orderId?: string; level?: number } | null>(null);
  const backPressCount = useRef(0);

  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [billingAlerts, setBillingAlerts] = useState<Record<string, number>>({}); // orderId -> lastNotifiedLevel
  const [dismissedAlerts, setDismissedAlerts] = useState<Record<string, number>>({}); // orderId -> dismissedLevel
  const [dismissedOverdue, setDismissedOverdue] = useState<Record<string, boolean>>({}); // orderId -> isDismissed

  const overdueAudioRef = useRef<HTMLAudioElement | null>(null);
  const billingAudioRef = useRef<HTMLAudioElement | null>(null);
  const billingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const playSound = (type: 'new-order' | 'threshold' | 'billing' | 'overdue') => {
    const urls = {
      'new-order': '/845147__sadiquecat__airplane-ding.wav', // Local Airplane Ding
      'threshold': '/snorcon-low-battery-421820.mp3', // Snorcorn Low Battery
      'billing': '/49053354-electronic-ping-305767.mp3', // Electronic Ping
      'overdue': '/freesound_community-car-seatbelt-alarm-86950.mp3'  // Car Seatbelt Alarm
    };

    const url = urls[type];
    
    // For one-shot sounds
    if (type === 'new-order' || type === 'threshold') {
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.play().catch(e => {
        if (e.name !== 'NotAllowedError') console.error(`Audio play failed for ${type}:`, e);
      });
      return;
    }

    // For looping sounds
    if (type === 'overdue') {
      if (!overdueAudioRef.current) {
        const audio = new Audio(url);
        audio.preload = 'auto';
        audio.loop = true;
        audio.play().catch(e => {
          if (e.name !== 'NotAllowedError') console.error(`Audio play failed for ${type}:`, e);
        });
        overdueAudioRef.current = audio;
      }
    }

    if (type === 'billing') {
      if (!billingIntervalRef.current) {
        const audio = new Audio(url);
        audio.preload = 'auto';
        const playPing = () => {
          audio.currentTime = 0;
          audio.play().catch(e => {
            if (e.name !== 'NotAllowedError') console.error(`Audio play failed for ${type}:`, e);
          });
        };
        playPing();
        billingIntervalRef.current = setInterval(playPing, 1000);
        billingAudioRef.current = audio;
      }
    }
  };

  const stopSound = (type: 'billing' | 'overdue') => {
    if (type === 'overdue') {
      if (overdueAudioRef.current) {
        overdueAudioRef.current.pause();
        overdueAudioRef.current.currentTime = 0;
        overdueAudioRef.current = null;
      }
    }
    if (type === 'billing') {
      if (billingIntervalRef.current) {
        clearInterval(billingIntervalRef.current);
        billingIntervalRef.current = null;
      }
      if (billingAudioRef.current) {
        billingAudioRef.current.pause();
        billingAudioRef.current = null;
      }
    }
  };

  const playAlertSound = () => playSound('threshold');

  const closeModalByName = (name: string) => {
    if (name === 'order-create') setIsOrderModalOpen(false);
    else if (name === 'menu-manage') setIsMenuModalOpen(false);
    else if (name === 'order-details') setSelectedOrder(null);
    else if (name === 'menu-edit') setEditingItem(null);
    else if (name === 'billing') setBillingOrder(null);
    else if (name === 'order-edit') setEditingOrder(null);
    else if (name === 'bill-details') setViewingBill(null);
    else if (name === 'order-view') setViewingOrder(null);
    else if (name === 'item-select') setSelectedItem(null);
  };

  const navigateTo = (tab: string, replace = false) => {
    if (tab !== activeTab || replace) {
      setHistory(prev => {
        const newHist = [...prev];
        if (replace && newHist.length > 0) newHist.pop();
        if (newHist[newHist.length - 1] !== tab) {
          newHist.push(tab);
        }
        return newHist;
      });
      setActiveTab(tab);
      if (replace) window.history.replaceState(null, '');
      else window.history.pushState(null, '');
    }
  };

  const openModal = (setter: (val: any) => void, value: any, name: string) => {
    setter(value);
    setHistory(prev => [...prev, `modal:${name}`]);
    window.history.pushState(null, '');
  };

  const handleBack = () => {
    window.history.back();
  };

  useEffect(() => {
    loadData();
    // Initialize history state if empty (shouldn't happen but for safety)
    if (window.history.state === null) {
      window.history.replaceState({ root: true }, '');
    }

    const handlePopState = (e: PopStateEvent) => {
      if (history.length > 1) {
        const newHistory = [...history];
        const lastState = newHistory.pop();
        
        if (lastState && typeof lastState === 'string' && lastState.startsWith('modal:')) {
          closeModalByName(lastState.split(':')[1]);
        } else if (lastState) {
          // Find the last actual tab in history to avoid setting activeTab to a modal name
          const lastTab = [...newHistory].reverse().find(s => typeof s === 'string' && !s.startsWith('modal:'));
          if (lastTab) setActiveTab(lastTab);
        }
        setHistory(newHistory);
        backPressCount.current = 0;
      } else {
        if (activeTab !== 'home') {
          setActiveTab('home');
          setHistory(['home']);
          backPressCount.current = 0;
        } else {
          if (backPressCount.current === 0) {
            setToast({ message: "Press back again to exit" });
            backPressCount.current++;
            setTimeout(() => { backPressCount.current = 0; }, 2000);
            window.history.pushState(null, ''); // Keep user on page
          } else {
            // In a real PWA on Android, this would exit. 
          }
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [history, activeTab]);

  // Notification Logic
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => console.error('SW registration failed:', err));
    }
  }, []);

  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }

    const interval = setInterval(() => {
      orders.filter(o => o.status === 'active').forEach(order => {
        const totalTime = order.customTime || calculateOrderTime(order.items);
        const elapsed = (Date.now() - order.timestamp) / 60000;
        const remainingPercent = ((totalTime - elapsed) / totalTime) * 100;

        if (remainingPercent <= settings.notificationThreshold && remainingPercent > 0) {
          const notifiedKey = `notified_${order.id}_${settings.notificationThreshold}`;
          if (!localStorage.getItem(notifiedKey)) {
            playSound('threshold');
            if (Notification.permission === 'granted') {
              if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.ready.then(registration => {
                  registration.showNotification("Order Alert", {
                    body: `Order #${order.orderNo} has ${Math.round(totalTime - elapsed)} mins left!`,
                    icon: settings.companyLogo || "https://picsum.photos/seed/pos/192/192",
                    vibrate: [200, 100, 200]
                  } as any);
                });
              } else {
                new Notification("Order Alert", {
                  body: `Order #${order.orderNo} has ${Math.round(totalTime - elapsed)} mins left!`,
                  icon: settings.companyLogo || "https://picsum.photos/seed/pos/192/192"
                });
              }
              localStorage.setItem(notifiedKey, 'true');
            }
          }
        }
      });
    }, 15000);

    return () => clearInterval(interval);
  }, [orders, settings]);

  // Billing Alert Logic
  useEffect(() => {
    if (!settings.enableBillingAlerts) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const x = settings.billingAlertThreshold;
      const y = settings.billingRepeatInterval;
      let hasActiveAlert = false;

      // Only alert if NOT paid
      orders.filter(o => o.status === 'to-bill' && o.servedTimestamp && !o.isPaid).forEach(order => {
        const elapsed = (now - (order.servedTimestamp || 0)) / 60000;
        let currentLevel = 0;

        if (elapsed >= x + y) {
          const extraTime = elapsed - (x + y);
          currentLevel = 2 + Math.floor(extraTime / (y / 4));
        } else if (elapsed >= x) {
          currentLevel = 1;
        }

        if (currentLevel > 0) {
          const lastLevel = billingAlerts[order.id] || 0;
          const dismissedLevel = dismissedAlerts[order.id] || 0;

          if (currentLevel > dismissedLevel) {
            hasActiveAlert = true;
          }

          if (currentLevel > lastLevel && currentLevel > dismissedLevel) {
            // Trigger Notification
            const title = "Billing Reminder";
            const options = {
              body: `Order #${order.orderNo} has been waiting for billing for ${Math.round(elapsed)} mins!`,
              icon: settings.companyLogo || "https://picsum.photos/seed/pos/192/192",
              tag: `billing_${order.id}`,
              vibrate: [200, 100, 200],
              actions: [
                { action: 'dismiss', title: 'Dismiss' },
                { action: 'dismiss_all', title: 'Dismiss All' }
              ]
            };

            if (Notification.permission === 'granted') {
              if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.ready.then(registration => {
                  registration.showNotification(title, options as any);
                });
              } else {
                new Notification(title, options);
              }
            }
            setToast({ 
              message: `Billing Alert: Order #${order.orderNo} (${Math.round(elapsed)}m)`,
              orderId: order.id,
              level: currentLevel
            });
            setBillingAlerts(prev => ({ ...prev, [order.id]: currentLevel }));
          }
        }
      });

      if (hasActiveAlert) {
        playSound('billing');
      } else {
        stopSound('billing');
      }
    }, 500); // Check every half second

    return () => {
      clearInterval(interval);
      stopSound('billing');
    };
  }, [orders, settings, billingAlerts, dismissedAlerts]);

  // Overdue Alert Logic
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const overdueOrders = orders.filter(o => o.status === 'active');
      
      let hasOverdue = false;
      overdueOrders.forEach(order => {
        const totalTime = order.customTime || calculateOrderTime(order.items);
        const elapsed = (now - order.timestamp) / 60000;
        
        if (elapsed > totalTime) {
          if (!dismissedOverdue[order.id]) {
            hasOverdue = true;
          }
          const notifiedKey = `overdue_${order.id}`;
          // We play sound every 3s if any order is overdue, but only show notification once
          if (!localStorage.getItem(notifiedKey)) {
            if (Notification.permission === 'granted') {
              const title = "Order Overdue!";
              const options = {
                body: `Order #${order.orderNo} is overdue and not served!`,
                icon: settings.companyLogo || "https://picsum.photos/seed/pos/192/192",
                tag: `overdue_${order.id}`,
                vibrate: [500, 100, 500],
                actions: [
                  { action: 'dismiss', title: 'Dismiss' },
                  { action: 'dismiss_all', title: 'Dismiss All' }
                ]
              };
              if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.ready.then(registration => {
                  registration.showNotification(title, options as any);
                });
              } else {
                new Notification(title, options);
              }
            }
            localStorage.setItem(notifiedKey, 'true');
            setToast({ 
              message: `Order Overdue: #${order.orderNo}`,
              orderId: order.id,
              level: 999 // Special level for overdue
            });
          }
        }
      });

      if (hasOverdue) {
        playSound('overdue');
      } else {
        stopSound('overdue');
      }
    }, 1000); // Check every second

    return () => {
      clearInterval(interval);
      stopSound('overdue');
    };
  }, [orders, settings]);

  const dismissAlert = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    if (order.status === 'to-bill') {
      const now = Date.now();
      const elapsed = (now - (order.servedTimestamp || 0)) / 60000;
      const x = settings.billingAlertThreshold;
      const y = settings.billingRepeatInterval;
      let currentLevel = 0;
      if (elapsed >= x + y) {
        const extraTime = elapsed - (x + y);
        currentLevel = 2 + Math.floor(extraTime / (y / 4));
      } else if (elapsed >= x) {
        currentLevel = 1;
      }
      setDismissedAlerts(prev => ({ ...prev, [orderId]: currentLevel }));
    } else if (order.status === 'active') {
      setDismissedOverdue(prev => ({ ...prev, [orderId]: true }));
    }
  };

  const dismissAllAlerts = () => {
    const now = Date.now();
    const newBillingDismissed = { ...dismissedAlerts };
    const newOverdueDismissed = { ...dismissedOverdue };
    
    orders.forEach(order => {
      if (order.status === 'to-bill') {
        const elapsed = (now - (order.servedTimestamp || 0)) / 60000;
        const x = settings.billingAlertThreshold;
        const y = settings.billingRepeatInterval;
        let currentLevel = 0;
        if (elapsed >= x + y) {
          const extraTime = elapsed - (x + y);
          currentLevel = 2 + Math.floor(extraTime / (y / 4));
        } else if (elapsed >= x) {
          currentLevel = 1;
        }
        if (currentLevel > 0) newBillingDismissed[order.id] = currentLevel;
      } else if (order.status === 'active') {
        const totalTime = order.customTime || calculateOrderTime(order.items);
        const elapsed = (now - order.timestamp) / 60000;
        if (elapsed > totalTime) newOverdueDismissed[order.id] = true;
      }
    });
    
    setDismissedAlerts(newBillingDismissed);
    setDismissedOverdue(newOverdueDismissed);
    setToast(null);
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'DISMISS_ALERT') {
        dismissAlert(event.data.orderId);
      } else if (event.data.type === 'DISMISS_ALL') {
        dismissAllAlerts();
      }
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage);
      return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
    }
  }, [orders, settings, dismissedAlerts, dismissedOverdue]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    document.body.classList.toggle('light', settings.theme === 'light');
    document.documentElement.style.setProperty('--accent-color', settings.accentColor);
    document.documentElement.style.setProperty('--bg-color', settings.bgColor);
    document.documentElement.style.setProperty('--light-bg-color', settings.lightBgColor || defaultSettings.lightBgColor);
    document.documentElement.style.setProperty('--border-radius', (settings.borderRadius ?? defaultSettings.borderRadius).toString());
  }, [settings]);

  const [viewingBill, setViewingBill] = useState<Bill | null>(null);
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);

  const loadData = async () => {
    const db = await getDB();
    const [m, o, b, s] = await Promise.all([
      db.getAll('menu'),
      db.getAll('orders'),
      db.getAll('bills'),
      db.get('settings', 'current')
    ]);
    setMenu(m);
    setOrders(o);
    setBills(b);
    if (s) setSettings({ ...defaultSettings, ...s });
  };

  const saveSettings = async (newSettings: Settings) => {
    const db = await getDB();
    await db.put('settings', newSettings);
    setSettings(newSettings);
  };

  // --- Order Logic ---

  const handlePlaceOrder = async () => {
    if (cart.length === 0) return;
    
    const db = await getDB();
    
    if (editingOrder) {
      const updatedOrder: Order = {
        ...editingOrder,
        tableNo: tableNo || undefined,
        items: cart,
        overallInstructions,
        customTime: customOrderTime === '' ? undefined : Number(customOrderTime)
      };
      await db.put('orders', updatedOrder);
      setOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));
    } else {
      const newOrder: Order = {
        id: crypto.randomUUID(),
        orderNo: generateOrderNo(orders.length),
        tableNo: tableNo || undefined,
        items: cart,
        status: 'active',
        timestamp: Date.now(),
        overallInstructions,
        customTime: customOrderTime === '' ? undefined : Number(customOrderTime)
      };
      await db.add('orders', newOrder);
      setOrders(prev => [...prev, newOrder]);
      playSound('new-order');
    }

    setCart([]);
    setOverallInstructions('');
    setCustomOrderTime('');
    setTableNo('');
    
    // Explicitly close modal
    setIsOrderModalOpen(false);
    setEditingOrder(null);
    
    if (activeTab !== 'orders') navigateTo('orders', true);
    setToast({ message: editingOrder ? "Order Updated!" : "Order Placed!" });
  };

  const startEditingOrder = (order: Order) => {
    setSelectedOrder(null);
    setViewingOrder(null);
    openModal(setEditingOrder, order, 'order-edit');
    setCart(order.items);
    setOverallInstructions(order.overallInstructions);
    setCustomOrderTime(order.customTime || '');
    setTableNo(order.tableNo || '');
  };

  const updateOrderStatus = async (orderId: string, status: 'to-bill' | 'completed' | 'paid') => {
    const db = await getDB();
    const order = await db.get('orders', orderId);
    if (!order) return;

    if (status === 'completed') {
      openModal(setBillingOrder, order, 'billing');
      return;
    }

    if (status === 'paid') {
      order.isPaid = true;
    } else {
      order.status = status;
      if (status === 'to-bill') order.servedTimestamp = Date.now();
    }
    
    await db.put('orders', order);
    setOrders(prev => prev.map(o => o.id === orderId ? order : o));
  };

  const deleteOrder = async (id: string) => {
    const db = await getDB();
    await db.delete('orders', id);
    setOrders(prev => prev.filter(o => o.id !== id));
  };

  // --- Bill Logic ---

  const handleCreateBill = async (billData: Partial<Bill>) => {
    if (!billingOrder) return;

    const db = await getDB();
    const newBill: Bill = {
      id: crypto.randomUUID(),
      orderId: billingOrder.id,
      orderNo: billingOrder.orderNo,
      items: billData.items || billingOrder.items,
      subtotal: billData.subtotal || 0,
      discount: billData.discount || { type: 'percent', value: 0 },
      taxPercent: billData.taxPercent || settings.defaultTax,
      total: billData.total || 0,
      isSold: billData.isSold ?? true,
      timestamp: Date.now(),
      customFields: billData.customFields || {}
    };

    await db.add('bills', newBill);
    
    // Mark order as completed
    const updatedOrder = { ...billingOrder, status: 'completed' as const, items: billData.items || billingOrder.items };
    await db.put('orders', updatedOrder);
    
    setBills(prev => [...prev, newBill]);
    setOrders(prev => prev.map(o => o.id === billingOrder.id ? updatedOrder : o));
    
    // Explicitly close modal first to prevent double clicks
    setBillingOrder(null);
    
    setToast({ message: "Bill Saved Successfully!" });
    navigateTo('bills', true);
  };

  const deleteBill = async (id: string) => {
    const db = await getDB();
    await db.delete('bills', id);
    setBills(prev => prev.filter(b => b.id !== id));
  };

  // --- Menu Logic ---

  const saveMenuItem = async (item: MenuItem) => {
    const db = await getDB();
    const isNew = !menu.find(i => i.id === item.id);
    const newItem = {
      ...item,
      createdAt: item.createdAt || Date.now(),
      customOrder: item.customOrder ?? (isNew ? menu.length : item.customOrder)
    };
    await db.put('menu', newItem);
    setMenu(prev => {
      const exists = prev.find(i => i.id === newItem.id);
      if (exists) return prev.map(i => i.id === newItem.id ? newItem : i);
      return [...prev, newItem];
    });
    setEditingItem(null);
  };

  const deleteMenuItem = async (id: string) => {
    const db = await getDB();
    await db.delete('menu', id);
    setMenu(prev => prev.filter(i => i.id !== id));
  };

  const sortMenu = (items: MenuItem[], method: Settings['menuSortMethod'], direction: Settings['menuSortDirection']) => {
    const sorted = [...items];
    if (method === 'custom') {
      return sorted.sort((a, b) => (a.customOrder || 0) - (b.customOrder || 0));
    }
    
    sorted.sort((a, b) => {
      let comparison = 0;
      if (method === 'alphabetical') {
        comparison = a.name.localeCompare(b.name);
      } else if (method === 'category') {
        comparison = a.category.localeCompare(b.category);
        if (comparison === 0) comparison = a.name.localeCompare(b.name);
      } else if (method === 'recent') {
        comparison = (a.createdAt || 0) - (b.createdAt || 0);
      }
      return direction === 'asc' ? comparison : -comparison;
    });
    return sorted;
  };

  // --- Tab Counts ---
  const counts = {
    orders: orders.filter(o => o.status === 'active' || o.status === 'to-bill').length,
    bills: bills.length
  };

  // --- Render Helpers ---

  const renderHome = () => {
    const today = new Date().setHours(0,0,0,0);
    const billsToday = bills.filter(b => b.timestamp >= today);
    const revToday = billsToday.reduce((sum, b) => sum + (b.isSold ? b.total : 0), 0);
    const activeOrders = orders.filter(o => o.status === 'active');
    const toBillOrders = orders.filter(o => o.status === 'to-bill');
    const recentOrders = [...orders].sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return b.timestamp - a.timestamp;
    }).slice(0, 5);

    return (
      <div className="space-y-4">
        <header className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tighter">Dashboard</h1>
            <p className="text-white/50 text-xs">{format(new Date(), 'EEEE, MMMM do')}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center text-accent">
            <UtensilsCrossed size={20} />
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/5 p-4 rounded-[20px] border border-white/10 space-y-0.5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-white/40">Rev Today</p>
            <p className="text-xl font-bold text-accent">{formatCurrency(revToday)}</p>
          </div>
          <button 
            onClick={() => setActiveTab('orders')}
            className={cn(
              "p-4 rounded-[20px] border transition-all text-left space-y-0.5",
              activeOrders.length > 0 ? "bg-accent/10 border-accent animate-pulse" : "bg-white/5 border-white/10"
            )}
          >
            <p className="text-[10px] font-medium uppercase tracking-widest text-white/40">Active Orders</p>
            <p className="text-xl font-bold">{activeOrders.length}</p>
          </button>
          <div className="bg-white/5 p-4 rounded-[20px] border border-white/10 space-y-0.5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-white/40">Bills Today</p>
            <div className="flex flex-col">
              <p className="text-xl font-bold">{billsToday.length}</p>
              <p className="text-[8px] text-white/30">All Time: {bills.length}</p>
            </div>
          </div>
          <button 
            onClick={() => setActiveTab('orders')}
            className={cn(
              "p-4 rounded-[20px] border transition-all text-left space-y-0.5",
              toBillOrders.length > 0 ? "bg-yellow-500/10 border-yellow-500 animate-smooth-flicker" : "bg-white/5 border-white/10"
            )}
          >
            <p className="text-[10px] font-medium uppercase tracking-widest text-white/40">To Bill</p>
            <p className="text-xl font-bold">{toBillOrders.length}</p>
          </button>
        </div>

        <button 
          onClick={() => openModal(setIsOrderModalOpen, true, 'order-create')}
          className="w-full bg-accent hover:bg-accent/90 text-white py-3 rounded-[20px] font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-accent/20"
        >
          <Plus size={20} />
          New Order
        </button>

        {recentOrders.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold tracking-tight">Recent Orders</h2>
            <motion.div 
              initial="hidden"
              animate="visible"
              variants={{
                visible: {
                  transition: {
                    staggerChildren: 0.05
                  }
                }
              }}
              className="space-y-3"
            >
              {recentOrders.map(order => (
                <OrderCard 
                  key={order.id} 
                  order={order} 
                  updateStatus={updateOrderStatus} 
                  deleteOrder={deleteOrder} 
                  setSelectedOrder={(val: any) => openModal(setSelectedOrder, val, 'order-details')} 
                  bills={bills}
                  setViewingBill={(val: any) => openModal(setViewingBill, val, 'bill-details')}
                  setToast={setToast}
                  onEdit={startEditingOrder}
                  onDismissAlert={dismissAlert}
                  settings={settings}
                  billingAlerts={billingAlerts}
                  dismissedAlerts={dismissedAlerts}
                  dismissedOverdue={dismissedOverdue}
                />
              ))}
            </motion.div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen pb-24 px-0 pt-4 max-w-lg mx-auto overflow-x-hidden">
      <AnimatePresence mode="wait">
        <AnimatePresence>
          {activeTab === 'orders' && (
            <motion.button 
              initial={{ scale: 0, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0, opacity: 0, y: 20 }}
              onClick={() => openModal(setIsOrderModalOpen, true, 'order-create')}
              className="fixed bottom-28 right-6 w-14 h-14 bg-accent text-white rounded-full shadow-2xl flex items-center justify-center active:scale-95 transition-all z-50"
            >
              <Plus size={28} />
            </motion.button>
          )}
        </AnimatePresence>

        <motion.div
          key={activeTab}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.1, ease: "easeInOut" }}
          className="px-4"
        >
          {activeTab === 'home' && renderHome()}
          {activeTab === 'orders' && <OrdersView orders={orders} updateStatus={updateOrderStatus} deleteOrder={deleteOrder} setSelectedOrder={(val: any) => openModal(setSelectedOrder, val, 'order-details')} openNewOrder={() => openModal(setIsOrderModalOpen, true, 'order-create')} bills={bills} setViewingBill={(val: any) => openModal(setViewingBill, val, 'bill-details')} setToast={setToast} onEdit={startEditingOrder} onDismissAlert={dismissAlert} settings={settings} billingAlerts={billingAlerts} dismissedAlerts={dismissedAlerts} dismissedOverdue={dismissedOverdue} />}
          {activeTab === 'bills' && <BillsView bills={bills} deleteBill={deleteBill} settings={settings} orders={orders} setViewingOrder={(val: any) => openModal(setViewingOrder, val, 'order-view')} setToast={setToast} setViewingBill={(val: any) => openModal(setViewingBill, val, 'bill-details')} />}
          {activeTab === 'menu' && <MenuView menu={menu} setMenu={setMenu} setEditingItem={(val: any) => openModal(setEditingItem, val, 'menu-edit')} deleteItem={deleteMenuItem} setIsMenuModalOpen={(val: any) => openModal(setIsMenuModalOpen, val, 'menu-manage')} settings={settings} saveSettings={saveSettings} sortMenu={sortMenu} />}
          {activeTab === 'settings' && <SettingsView settings={settings} saveSettings={saveSettings} bills={bills} setBills={setBills} menu={menu} setMenu={setMenu} orders={orders} setOrders={setOrders} />}
        </motion.div>
      </AnimatePresence>

      <BottomNav activeTab={activeTab} navigateTo={navigateTo} counts={counts} />

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-white/80 backdrop-blur-md text-black px-4 py-2 rounded-full font-bold text-xs shadow-xl z-[200] flex items-center gap-3"
          >
            <span>{toast.message}</span>
            {toast.orderId && (
              <div className="flex gap-2">
                <button 
                  onClick={() => {
                    if (toast.orderId) {
                      if (toast.level === 999) {
                        setDismissedOverdue(prev => ({ ...prev, [toast.orderId!]: true }));
                      } else if (toast.level) {
                        setDismissedAlerts(prev => ({ ...prev, [toast.orderId!]: toast.level! }));
                      }
                    }
                    setToast(null);
                  }}
                  className="bg-black/10 px-2 py-1 rounded-full text-[10px] hover:bg-black/20 transition-colors"
                >
                  Dismiss
                </button>
                <button 
                  onClick={dismissAllAlerts}
                  className="bg-black/10 px-2 py-1 rounded-full text-[10px] hover:bg-black/20 transition-colors"
                >
                  Dismiss All
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <Modal isOpen={isOrderModalOpen} onClose={handleBack} title="New Order" fullScreen>
        <OrderCreationView 
          menu={menu} 
          onPlaceOrder={handlePlaceOrder} 
          cart={cart} 
          setCart={setCart} 
          overallInstructions={overallInstructions} 
          setOverallInstructions={setOverallInstructions}
          customOrderTime={customOrderTime}
          setCustomOrderTime={setCustomOrderTime}
          tableNo={tableNo}
          setTableNo={setTableNo}
          settings={settings}
          sortMenu={sortMenu}
          selectedItem={selectedItem}
          setSelectedItem={(val: any) => openModal(setSelectedItem, val, 'item-select')}
          onBack={handleBack}
        />
      </Modal>

      <Modal isOpen={!!selectedOrder} onClose={handleBack} title={`Order #${selectedOrder?.orderNo}`}>
        {selectedOrder && <OrderDetailView order={selectedOrder} onEdit={startEditingOrder} />}
      </Modal>

      <Modal isOpen={!!viewingBill} onClose={handleBack} title={`Bill #${viewingBill?.orderNo}`}>
        {viewingBill && <BillDetailView bill={viewingBill} settings={settings} />}
      </Modal>

      <Modal isOpen={!!viewingOrder} onClose={handleBack} title={`Order #${viewingOrder?.orderNo}`}>
        {viewingOrder && <OrderDetailView order={viewingOrder} onEdit={startEditingOrder} />}
      </Modal>

      <Modal isOpen={!!editingOrder} onClose={handleBack} title="Edit Order" fullScreen>
        <OrderCreationView 
          menu={menu} 
          onPlaceOrder={handlePlaceOrder} 
          cart={cart} 
          setCart={setCart} 
          overallInstructions={overallInstructions} 
          setOverallInstructions={setOverallInstructions}
          customOrderTime={customOrderTime}
          setCustomOrderTime={setCustomOrderTime}
          tableNo={tableNo}
          setTableNo={setTableNo}
          settings={settings}
          sortMenu={sortMenu}
          selectedItem={selectedItem}
          setSelectedItem={(val: any) => openModal(setSelectedItem, val, 'item-select')}
          onBack={handleBack}
        />
      </Modal>

      <Modal isOpen={isMenuModalOpen} onClose={handleBack} title="Manage Menu" fullScreen>
        <ManageMenuView 
          menu={menu} 
          setMenu={setMenu} 
          setEditingItem={(val: any) => openModal(setEditingItem, val, 'menu-edit')} 
          deleteMenuItem={deleteMenuItem} 
          formatCurrency={formatCurrency}
        />
      </Modal>

      <Modal isOpen={!!editingItem} onClose={handleBack} title={editingItem?.name ? "Edit Item" : "Add Item"}>
        <MenuItemForm item={editingItem} onSave={(item: any) => { saveMenuItem(item); handleBack(); }} onCancel={handleBack} onDelete={(id: string) => { deleteMenuItem(id); handleBack(); }} />
      </Modal>

      <Modal isOpen={!!billingOrder} onClose={handleBack} title="Create Bill">
        {billingOrder && <BillCreationView order={billingOrder} onSave={(bill: any) => { handleCreateBill(bill); }} settings={settings} />}
      </Modal>
    </div>
  );
}

// --- Sub-Views ---

const OrderCard = ({ order, updateStatus, deleteOrder, setSelectedOrder, bills, setViewingBill, setToast, onEdit, onDismissAlert, settings, billingAlerts, dismissedAlerts, dismissedOverdue, forceExpand }: any) => {
  const [timeLeft, setTimeLeft] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (forceExpand !== undefined) {
      setIsExpanded(forceExpand);
    }
  }, [forceExpand]);

  useEffect(() => {
    const calculate = () => {
      const totalTime = order.customTime || calculateOrderTime(order.items);
      const elapsed = (Date.now() - order.timestamp) / 60000;
      setTimeLeft(Math.max(0, totalTime - elapsed));
    };

    calculate();
    if (order.status === 'active') {
      const interval = setInterval(calculate, 1000);
      return () => clearInterval(interval);
    }
  }, [order]);

  const viewBill = (e: React.MouseEvent) => {
    e.stopPropagation();
    const bill = bills.find((b: any) => b.orderId === order.id);
    if (bill) {
      setViewingBill(bill);
    } else {
      setToast({ message: "Corresponding Bill for Order was Deleted or Missing" });
    }
  };

  const totalAmount = calculateOrderTotal(order.items);

  return (
    <motion.div 
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0 }
      }}
      onClick={() => {
        setSelectedOrder(order);
        onDismissAlert(order.id);
      }}
      className={cn(
        "bg-white/5 border rounded-[20px] p-4 space-y-3 active:scale-[0.98] transition-all mx-1 my-1",
        order.status === 'active' ? "border-accent animate-smooth-flicker" : 
        order.status === 'to-bill' ? "border-yellow-500 animate-smooth-flicker" : "border-white/10"
      )}
    >
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={cn(
              "text-[10px] font-bold text-white/40 uppercase tracking-widest",
              ((order.status === 'active' && (Date.now() - order.timestamp) / 60000 > (order.customTime || calculateOrderTime(order.items)) && !dismissedOverdue[order.id]) ||
               (order.status === 'to-bill' && order.servedTimestamp && !order.isPaid && (Date.now() - order.servedTimestamp) / 60000 >= settings.billingAlertThreshold && (dismissedAlerts[order.id] || 0) < (billingAlerts[order.id] || 0))) && 
              "text-accent animate-glow-flicker"
            )}>
              Order #{order.orderNo}
            </p>
            {order.tableNo && (
              <span className="bg-accent/10 text-accent text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">Table {order.tableNo}</span>
            )}
            {order.isPaid && (
              <span className="bg-green-500/10 text-green-500 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">PAID</span>
            )}
          </div>
          <p className="text-lg font-bold text-accent">{formatCurrency(totalAmount)}</p>
          
          <AnimatePresence>
            {isExpanded && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-1 space-y-0.5 overflow-hidden"
              >
                {order.items.map((item: any, idx: number) => (
                  <div key={idx} className="flex flex-col">
                    <p className="text-[11px] font-bold truncate">• {item.name} x {item.quantity}</p>
                    {(item.extras?.length > 0 || item.instructions) && (
                      <p className="text-[9px] text-white/40 ml-3 leading-tight">
                        {item.extras?.map((e: any) => `${e.name} (x${e.quantity})`).join(', ')}
                        {item.instructions && ` | ${item.instructions}`}
                      </p>
                    )}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {!isExpanded && (
            <div className="mt-1 flex items-center gap-2">
              <p className="text-[10px] text-white/40 font-medium">
                {order.items.length} {order.items.length === 1 ? 'item' : 'items'} • {order.items.map((i: any) => i.name).join(', ').slice(0, 30)}...
              </p>
              <button 
                onClick={(e) => { e.stopPropagation(); setIsExpanded(true); }}
                className="text-accent text-[10px] font-bold flex items-center gap-0.5"
              >
                Show More <ChevronDown size={10} />
              </button>
            </div>
          )}
          
          {isExpanded && (
            <button 
              onClick={(e) => { e.stopPropagation(); setIsExpanded(false); }}
              className="mt-2 text-accent text-[10px] font-bold flex items-center gap-0.5"
            >
              Show Less <ChevronUp size={10} />
            </button>
          )}
        </div>
        <div className="text-right ml-4">
          <div className={cn(
            "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest mb-1 inline-block",
            order.status === 'active' ? "bg-accent/20 text-accent" : 
            order.status === 'to-bill' ? "bg-yellow-500/20 text-yellow-500" : "bg-green-500/20 text-green-500"
          )}>
            {order.status === 'to-bill' ? 'UNPAID' : order.status}
          </div>
          {order.status === 'active' ? (
            <p className={cn("text-xl font-bold font-mono", timeLeft < 1 ? "text-red-500 animate-pulse" : "text-accent")}>
              {formatTimeLeft(timeLeft)}
            </p>
          ) : (
            <p className="text-xl font-bold text-green-500 uppercase tracking-tighter">DONE</p>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-white/5">
        <div className="flex items-center gap-2 text-white/40 text-[10px]">
          <Clock size={12} />
          {format(order.timestamp, 'HH:mm')}
        </div>
        <div className="flex gap-1.5">
          {order.status !== 'completed' && (
            <button 
              onClick={(e) => { e.stopPropagation(); onEdit(order); }}
              className="bg-white/10 text-white p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            >
              <SettingsIcon size={14} />
            </button>
          )}
          {order.status === 'completed' && (
            <button 
              onClick={viewBill}
              className="bg-white/10 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold"
            >
              View Bill
            </button>
          )}
          <button 
            onClick={(e) => { e.stopPropagation(); deleteOrder(order.id); }}
            className="p-1.5 text-red-500/50 hover:text-red-500 transition-colors"
          >
            <Trash2 size={16} />
          </button>
          {order.status === 'active' && (
            <>
              {!order.isPaid && (
                <button 
                  onClick={(e) => { e.stopPropagation(); updateStatus(order.id, 'paid'); }}
                  className="bg-green-500/20 text-green-500 px-3 py-1.5 rounded-lg text-[10px] font-bold"
                >
                  Mark Paid
                </button>
              )}
              <button 
                onClick={(e) => { e.stopPropagation(); updateStatus(order.id, 'to-bill'); }}
                className="bg-white/10 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold"
              >
                Serve
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); updateStatus(order.id, 'completed'); }}
                className="bg-accent text-white px-3 py-1.5 rounded-lg text-[10px] font-bold"
              >
                Bill
              </button>
            </>
          )}
          {order.status === 'to-bill' && (
            <button 
              onClick={(e) => { e.stopPropagation(); updateStatus(order.id, 'completed'); }}
              className="bg-yellow-500 text-black px-3 py-1.5 rounded-lg text-[10px] font-bold"
            >
              Bill
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

const OrdersView = ({ orders, updateStatus, deleteOrder, setSelectedOrder, openNewOrder, bills, setViewingBill, setToast, onEdit, onDismissAlert, settings, billingAlerts, dismissedAlerts, dismissedOverdue }: any) => {
  const [filter, setFilter] = useState('all');
  const [allExpanded, setAllExpanded] = useState(false);
  const tabs = ['all', 'active', 'to-bill', 'completed'];

  const filteredOrders = orders.filter((o: any) => filter === 'all' || o.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tighter">Orders</h1>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setAllExpanded(!allExpanded)}
            className="bg-white/5 border border-white/10 text-white/60 px-3 py-2 rounded-xl text-[10px] font-bold flex items-center gap-1.5 active:scale-95 transition-all"
          >
            {allExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {allExpanded ? 'Collapse All' : 'Expand All'}
          </button>
        </div>
      </div>
      <div className="flex gap-1 pb-1 no-scrollbar">
        {tabs.map(t => {
          const count = orders.filter((o: any) => o.status === t).length;
          const isActiveOrToBill = t === 'active' || t === 'to-bill' || (t === 'all' && orders.some((o: any) => o.status === 'active' || o.status === 'to-bill'));
          return (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={cn(
                "flex-1 px-1 py-1.5 rounded-full text-[8px] font-bold uppercase tracking-widest border transition-all whitespace-nowrap text-center",
                filter === t ? "bg-accent border-accent text-white" : "bg-white/5 border-white/10 text-white/50",
                isActiveOrToBill && count > 0 ? "animate-smooth-flicker" : ""
              )}
            >
              {t} ({t === 'all' ? orders.length : count})
            </button>
          );
        })}
      </div>

      <motion.div 
        initial="hidden"
        animate="visible"
        variants={{
          visible: {
            transition: {
              staggerChildren: 0.05
            }
          }
        }}
        className="space-y-3"
      >
        {filteredOrders.sort((a: any, b: any) => b.timestamp - a.timestamp).map((order: any) => (
          <OrderCard 
            key={order.id} 
            order={order} 
            updateStatus={updateStatus} 
            deleteOrder={deleteOrder} 
            setSelectedOrder={setSelectedOrder} 
            bills={bills}
            setViewingBill={setViewingBill}
            setToast={setToast}
            onEdit={onEdit}
            onDismissAlert={onDismissAlert}
            settings={settings}
            billingAlerts={billingAlerts}
            dismissedAlerts={dismissedAlerts}
            dismissedOverdue={dismissedOverdue}
            forceExpand={allExpanded}
          />
        ))}
      </motion.div>
    </div>
  );
};

const OrderDetailView = ({ order, onEdit }: { order: Order, onEdit: (o: Order) => void }) => {
  const totalTime = order.customTime || calculateOrderTime(order.items);
  const elapsed = (Date.now() - order.timestamp) / 60000;
  const timeLeft = Math.max(0, totalTime - elapsed);
  const totalAmount = calculateOrderTotal(order.items);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl">
        <div>
          <p className="text-xs text-white/40 uppercase tracking-widest font-bold">Placed At</p>
          <p className="font-bold">{format(order.timestamp, 'HH:mm:ss')}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-white/40 uppercase tracking-widest font-bold">Status</p>
          {order.status === 'active' ? (
            <p className={cn("font-bold text-xl font-mono", timeLeft < 1 ? "text-red-500 animate-pulse" : "text-accent")}>
              {formatTimeLeft(timeLeft)}
            </p>
          ) : (
            <p className="text-xl font-bold text-green-500 uppercase tracking-tighter">DONE</p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/40">Items</h3>
          {order.status !== 'completed' && (
            <button 
              onClick={() => onEdit(order)}
              className="flex items-center gap-1.5 bg-accent/10 text-accent px-3 py-1.5 rounded-xl text-xs font-bold active:scale-95 transition-all"
            >
              <SettingsIcon size={14} /> Edit Order
            </button>
          )}
        </div>
        {order.items.map((item, idx) => {
          const itemSubtotal = (item.price * item.quantity) + item.extras.reduce((s:any,e:any)=>s+(e.price*e.quantity),0);
          return (
            <div key={idx} className="bg-white/5 border border-white/5 p-4 rounded-2xl space-y-2">
              <div className="flex justify-between font-bold">
                <span>{item.quantity}x {item.name}</span>
                <span>{formatCurrency(itemSubtotal)}</span>
              </div>
              <div className="flex justify-between text-[10px] text-white/40 pl-4">
                <span>Item price - {formatCurrency(item.price)}</span>
              </div>
              {item.instructions && (
                <p className="text-xs text-white/50 italic pl-4">Note: {item.instructions}</p>
              )}
              {item.extras.length > 0 && (
                <div className="pl-4 border-l border-white/10 space-y-1">
                  {item.extras.map((e, eidx) => (
                    <div key={eidx} className="flex justify-between text-xs text-white/60">
                      <span>+ {e.quantity}x {e.name}</span>
                      <span>{formatCurrency(e.price * e.quantity)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="pt-4 border-t border-white/10">
        <div className="flex justify-between items-center">
          <p className="text-lg font-bold uppercase tracking-widest text-white/40">Total Amount</p>
          <p className="text-2xl font-bold text-accent">{formatCurrency(totalAmount)}</p>
        </div>
      </div>

      {order.overallInstructions && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/40">Overall Instructions</h3>
          <div className="bg-accent/5 border border-accent/10 p-4 rounded-2xl text-sm italic">
            {order.overallInstructions}
          </div>
        </div>
      )}
    </div>
  );
};

const BillDetailView = ({ bill, settings }: { bill: Bill, settings: Settings }) => {
  return (
    <div className="space-y-6">
      <div className="bg-white/5 p-6 rounded-[24px] border border-white/10 space-y-4">
        <div className="flex justify-between items-center">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center overflow-hidden">
            {settings.companyLogo ? (
              <img src={settings.companyLogo} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <Receipt size={32} className="text-accent" />
            )}
          </div>
          <div className="text-right">
            <p className="text-xs font-bold text-white/40 uppercase tracking-widest">{settings.billHeader}</p>
            <p className="text-lg font-bold">Bill #{bill.orderNo}</p>
            <p className="text-xs text-white/40">{format(bill.timestamp, 'MMM d, yyyy HH:mm')}</p>
          </div>
        </div>

        <div className="space-y-3 pt-4 border-t border-white/5">
          {bill.items.map((item: any, idx: number) => {
            const itemSubtotal = (item.price * item.quantity) + item.extras.reduce((s:any,e:any)=>s+(e.price*e.quantity),0);
            const discAmt = item.discount ? (item.discount.type === 'percent' ? (itemSubtotal * (item.discount.value / 100)) : item.discount.value) : 0;
            return (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between font-bold text-sm">
                  <span>{item.quantity}x {item.name}</span>
                  <span>{formatCurrency(itemSubtotal)}</span>
                </div>
                <div className="flex justify-between text-[10px] text-white/40 pl-4">
                  <span>Unit: {formatCurrency(item.price)}</span>
                  {discAmt > 0 && <span className="text-accent font-bold">Final: {formatCurrency(itemSubtotal - discAmt)}</span>}
                </div>
                {item.discount && item.discount.value > 0 && (
                  <div className="flex justify-between text-[10px] text-red-500 pl-4 italic">
                    <span>Discount ({item.discount.value}{item.discount.type === 'percent' ? '%' : ' PKR'})</span>
                    <span>-{formatCurrency(discAmt)}</span>
                  </div>
                )}
                {item.extras.map((e: any, eidx: number) => (
                  <div key={eidx} className="flex justify-between text-[10px] text-white/50 pl-4">
                    <span>+ {e.quantity}x {e.name}</span>
                    <span>{formatCurrency(e.price * e.quantity)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="pt-4 border-t border-white/5 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Subtotal</span>
            <span>{formatCurrency(bill.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Discount ({bill.discount.value}{bill.discount.type === 'percent' ? '%' : ' PKR'})</span>
            <span className="text-red-500">-{formatCurrency(bill.discount.type === 'percent' ? (bill.subtotal * (bill.discount.value / 100)) : bill.discount.value)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Tax ({bill.taxPercent}%)</span>
            <span>{formatCurrency((bill.subtotal - (bill.discount.type === 'percent' ? (bill.subtotal * (bill.discount.value / 100)) : bill.discount.value)) * (bill.taxPercent / 100))}</span>
          </div>
          <div className="flex justify-between items-center pt-2">
            <span className="text-lg font-bold">Total</span>
            <span className="text-2xl font-bold text-accent">{formatCurrency(bill.total)}</span>
          </div>
        </div>

        {Object.keys(bill.customFields).length > 0 && (
          <div className="pt-4 border-t border-white/5 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Additional Info</p>
            {Object.entries(bill.customFields).map(([key, value]) => (
              <div key={key} className="flex justify-between text-xs">
                <span className="text-white/40">{key}</span>
                <span className="font-medium">{value as string}</span>
              </div>
            ))}
          </div>
        )}

        <div className="pt-4 text-center">
          <p className="text-[10px] text-white/30 italic uppercase tracking-widest">{settings.billFooter}</p>
        </div>
      </div>
      
      {!bill.isSold && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-center gap-3 text-red-500">
          <AlertCircle size={20} />
          <p className="text-sm font-bold uppercase tracking-widest">Personal Use / Not Sold</p>
        </div>
      )}
    </div>
  );
};

const OrderCreationView = ({ menu, onPlaceOrder, cart, setCart, overallInstructions, setOverallInstructions, customOrderTime, setCustomOrderTime, tableNo, setTableNo, settings, sortMenu, selectedItem, setSelectedItem, onBack }: any) => {
  const [itemInstructions, setItemInstructions] = useState('');
  const [itemExtras, setItemExtras] = useState<any[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [activeCategory, setActiveCategory] = useState('All');
  const [isSaving, setIsSaving] = useState(false);

  const categories = ['All', ...Array.from(new Set(menu.map((item: any) => item.category).filter(Boolean)))];
  
  const sortedMenu = sortMenu(menu, settings.menuSortMethod, settings.menuSortDirection);
  const filteredMenu = activeCategory === 'All' 
    ? sortedMenu 
    : sortedMenu.filter((item: any) => item.category === activeCategory);

  const addToCart = () => {
    if (!selectedItem) return;
    const orderItem: OrderItem = {
      id: crypto.randomUUID(),
      menuItemId: selectedItem.id,
      name: selectedItem.name,
      price: selectedItem.price,
      quantity,
      prepTime: selectedItem.prepTime,
      instructions: itemInstructions,
      extras: itemExtras.filter(e => e.quantity > 0)
    };
    setCart([...cart, orderItem]);
    onBack(); // Close the item select modal
    setItemInstructions('');
    setItemExtras([]);
    setQuantity(1);
  };

  const cartTotal = cart.reduce((sum: number, item: any) => {
    const extrasSum = item.extras.reduce((es: number, e: any) => es + (e.price * e.quantity), 0);
    return sum + (item.price * item.quantity) + extrasSum;
  }, 0);

  const currentItemExtrasTotal = itemExtras.reduce((sum, e) => sum + (e.price * e.quantity), 0);
  const currentItemTotal = selectedItem ? (selectedItem.price * quantity) + currentItemExtrasTotal : 0;

  return (
    <div className="space-y-6">
      {cart.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-white/10">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-base">Cart ({cart.length})</h3>
            <p className="text-lg font-bold text-accent">{formatCurrency(cartTotal)}</p>
          </div>
          <div className="space-y-2">
            {cart.map((item: any, idx: number) => (
              <div key={idx} className="flex justify-between items-start bg-white/5 p-3 rounded-xl">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{item.quantity}x {item.name}</p>
                  <p className="text-[10px] text-white/40">{formatCurrency((item.price * item.quantity) + item.extras.reduce((s:any,e:any)=>s+(e.price*e.quantity),0))}</p>
                  {(item.extras?.length > 0 || item.instructions) && (
                    <div className="mt-1 pl-2 border-l border-white/10">
                      {item.extras?.map((e: any, eidx: number) => (
                        <p key={eidx} className="text-[9px] text-white/40">+ {e.name} (x{e.quantity})</p>
                      ))}
                      {item.instructions && <p className="text-[9px] text-accent italic">Note: {item.instructions}</p>}
                    </div>
                  )}
                </div>
                <button onClick={() => setCart(cart.filter((_: any, i: number) => i !== idx))} className="text-red-500/50 p-1.5">
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
          
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-[9px] font-bold uppercase tracking-widest text-white/40 ml-1">Table No</p>
                <input 
                  type="text"
                  placeholder="e.g. 5"
                  value={tableNo}
                  onChange={(e) => setTableNo(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs focus:border-accent outline-none"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[9px] font-bold uppercase tracking-widest text-white/40 ml-1">Custom Time (min)</p>
                <input 
                  type="number"
                  placeholder="Auto"
                  value={customOrderTime}
                  onChange={(e) => setCustomOrderTime(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs focus:border-accent outline-none"
                />
              </div>
            </div>
            <textarea 
              placeholder="Overall Instructions..."
              value={overallInstructions}
              onChange={(e) => setOverallInstructions(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs focus:border-accent outline-none min-h-[60px]"
            />
            <button 
              onClick={() => {
                if (isSaving) return;
                setIsSaving(true);
                onPlaceOrder();
              }}
              disabled={isSaving}
              className={cn(
                "w-full py-3.5 rounded-xl font-bold text-base shadow-lg shadow-accent/20 active:scale-95 transition-all",
                isSaving ? "bg-accent/50 text-white/50 cursor-not-allowed" : "bg-accent text-white"
              )}
            >
              {isSaving ? "Placing Order..." : "Place Order"}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {categories.map(cat => (
          <button
            key={cat as string}
            onClick={() => setActiveCategory(cat as string)}
            className={cn(
              "px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all whitespace-nowrap",
              activeCategory === cat ? "bg-accent border-accent text-white" : "bg-white/5 border-white/10 text-white/50"
            )}
          >
            {cat as string}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 pb-4">
        {filteredMenu.map((item: any) => (
          <button 
            key={item.id}
            onClick={() => {
              setSelectedItem(item);
              setItemExtras(item.extras.map((e: any) => ({ ...e, quantity: 0 })));
            }}
            className="bg-white/5 border border-white/10 rounded-[20px] overflow-hidden text-left active:scale-95 transition-all"
          >
            <div className="aspect-square bg-white/5 relative">
              {item.image ? (
                <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/10">
                  <UtensilsCrossed size={32} />
                </div>
              )}
              <div className="absolute bottom-1.5 right-1.5 bg-black/60 blur-overlay px-1.5 py-0.5 rounded-md text-[8px] font-bold">
                {item.prepTime}m
              </div>
            </div>
            <div className="p-3">
              <p className="font-bold text-sm truncate">{item.name}</p>
              <p className="text-accent font-bold text-xs">{formatCurrency(item.price)}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Item Customization Modal */}
      <Modal isOpen={!!selectedItem} onClose={onBack} title={selectedItem?.name || "Customize Item"}>
        {selectedItem && (
          <div className="space-y-6">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-4 bg-white/5 p-2 rounded-2xl">
                <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">-</button>
                <span className="font-bold text-xl w-8 text-center">{quantity}</span>
                <button onClick={() => setQuantity(quantity + 1)} className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">+</button>
              </div>
              <p className="text-2xl font-bold text-accent">{formatCurrency(currentItemTotal)}</p>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white/40">Extras</h3>
              <div className="space-y-3">
                {itemExtras.map((extra, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-white/5 p-4 rounded-2xl">
                    <div>
                      <p className="font-bold">{extra.name}</p>
                      <p className="text-xs text-accent">{formatCurrency(extra.price)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => {
                        const newExtras = [...itemExtras];
                        newExtras[idx].quantity = Math.max(0, newExtras[idx].quantity - 1);
                        setItemExtras(newExtras);
                      }} className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">-</button>
                      <span className="font-bold w-4 text-center">{extra.quantity}</span>
                      <button onClick={() => {
                        const newExtras = [...itemExtras];
                        newExtras[idx].quantity += 1;
                        setItemExtras(newExtras);
                      }} className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">+</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <textarea 
              placeholder="Special Instructions for this item..."
              value={itemInstructions}
              onChange={(e) => setItemInstructions(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm focus:border-accent outline-none min-h-[100px]"
            />

            <button 
              onClick={addToCart}
              className="w-full bg-accent text-white py-5 rounded-[24px] font-bold text-lg active:scale-95 transition-all"
            >
              Add to Order
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
};

const BillCreationView = ({ order, onSave, settings }: any) => {
  const [discountType, setDiscountType] = useState<'flat' | 'percent'>('percent');
  const [discountValue, setDiscountValue] = useState(0);
  const [taxPercent, setTaxPercent] = useState(settings.defaultTax);
  const [isSold, setIsSold] = useState(true);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [itemDiscounts, setItemDiscounts] = useState<Record<string, { type: 'flat' | 'percent', value: number }>>({});

  const [isSaving, setIsSaving] = useState(false);

  const subtotal = order.items.reduce((sum: number, item: any, idx: number) => {
    const extrasSum = item.extras.reduce((es: number, e: any) => es + (e.price * e.quantity), 0);
    const itemSubtotal = (item.price * item.quantity) + extrasSum;
    const itemDiscount = itemDiscounts[idx] || { type: 'percent', value: 0 };
    const discAmt = itemDiscount.type === 'percent' ? (itemSubtotal * (itemDiscount.value / 100)) : itemDiscount.value;
    return sum + (itemSubtotal - discAmt);
  }, 0);

  const discountAmt = discountType === 'percent' ? (subtotal * (discountValue / 100)) : discountValue;
  const taxAmt = (subtotal - discountAmt) * (taxPercent / 100);
  const total = subtotal - discountAmt + taxAmt;

  const handleSave = () => {
    if (isSaving) return;
    setIsSaving(true);
    const updatedItems = order.items.map((item: any, idx: number) => ({
      ...item,
      discount: itemDiscounts[idx]
    }));
    onSave({ 
      items: updatedItems,
      discount: { type: discountType, value: discountValue }, 
      taxPercent, 
      isSold, 
      customFields,
      subtotal,
      total
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-white/40">Item Discounts</h3>
        {order.items.map((item: any, idx: number) => {
          const extrasSum = item.extras.reduce((es: number, e: any) => es + (e.price * e.quantity), 0);
          const itemSubtotal = (item.price * item.quantity) + extrasSum;
          const itemDiscount = itemDiscounts[idx] || { type: 'percent', value: 0 };
          const discAmt = itemDiscount.type === 'percent' ? (itemSubtotal * (itemDiscount.value / 100)) : itemDiscount.value;
          
          return (
            <div key={idx} className="bg-white/5 p-4 rounded-2xl space-y-3 border border-white/10">
              <div className="flex justify-between items-center">
                <div className="space-y-0.5">
                  <span className="font-bold text-sm">{item.name}</span>
                  <div className="flex gap-3 text-[10px] text-white/40">
                    <span>Unit: {formatCurrency(item.price)}</span>
                    <span>Total: {formatCurrency(itemSubtotal)}</span>
                    {discAmt > 0 && <span className="text-accent font-bold">Final: {formatCurrency(itemSubtotal - discAmt)}</span>}
                  </div>
                </div>
                <div className="flex bg-white/5 rounded-lg p-1">
                  <button 
                    onClick={() => setItemDiscounts({ ...itemDiscounts, [idx]: { type: 'percent', value: itemDiscounts[idx]?.value || 0 } })} 
                    className={cn("px-2 py-1 text-[9px] font-bold rounded-md", (itemDiscounts[idx]?.type || 'percent') === 'percent' ? "bg-accent text-white" : "text-white/40")}
                  >%</button>
                  <button 
                    onClick={() => setItemDiscounts({ ...itemDiscounts, [idx]: { type: 'flat', value: itemDiscounts[idx]?.value || 0 } })} 
                    className={cn("px-2 py-1 text-[9px] font-bold rounded-md", itemDiscounts[idx]?.type === 'flat' ? "bg-accent text-white" : "text-white/40")}
                  >PKR</button>
                </div>
              </div>
              <input 
                type="number"
                placeholder="Discount value..."
                value={itemDiscounts[idx]?.value || ''}
                onChange={(e) => setItemDiscounts({ ...itemDiscounts, [idx]: { type: itemDiscounts[idx]?.type || 'percent', value: Number(e.target.value) } })}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-2 text-xs focus:border-accent outline-none"
              />
            </div>
          );
        })}
      </div>

      <div className="bg-white/5 p-6 rounded-[24px] space-y-4 border border-white/10">
        <div className="flex justify-between text-sm">
          <span className="text-white/40">Subtotal (after item disc.)</span>
          <span className="font-bold">{formatCurrency(subtotal)}</span>
        </div>
        
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-white/40">Overall Discount</span>
            <div className="flex bg-white/5 rounded-lg p-1">
              <button onClick={() => setDiscountType('percent')} className={cn("px-3 py-1 text-[10px] font-bold rounded-md", discountType === 'percent' ? "bg-accent text-white" : "text-white/40")}>%</button>
              <button onClick={() => setDiscountType('flat')} className={cn("px-3 py-1 text-[10px] font-bold rounded-md", discountType === 'flat' ? "bg-accent text-white" : "text-white/40")}>PKR</button>
            </div>
          </div>
          <input 
            type="number"
            value={discountValue}
            onChange={(e) => setDiscountValue(Number(e.target.value))}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm focus:border-accent outline-none"
          />
        </div>

        <div className="space-y-2">
          <span className="text-sm text-white/40">Tax %</span>
          <input 
            type="number"
            value={taxPercent}
            onChange={(e) => setTaxPercent(Number(e.target.value))}
            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm focus:border-accent outline-none"
          />
        </div>

        <div className="pt-4 border-t border-white/10 flex justify-between items-center">
          <span className="text-lg font-bold">Total</span>
          <span className="text-2xl font-bold text-accent">{formatCurrency(total)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between bg-white/5 p-4 rounded-[24px] border border-white/10">
        <span className="font-bold">Sold?</span>
        <div className="flex bg-white/5 rounded-xl p-1">
          <button onClick={() => setIsSold(true)} className={cn("px-6 py-2 rounded-lg font-bold text-sm", isSold ? "bg-green-500 text-white" : "text-white/40")}>YES</button>
          <button onClick={() => setIsSold(false)} className={cn("px-6 py-2 rounded-lg font-bold text-sm", !isSold ? "bg-red-500 text-white" : "text-white/40")}>NO</button>
        </div>
      </div>

      {settings.customBillFields.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/40">Custom Fields</h3>
          {settings.customBillFields.map((field: string) => (
            <div key={field} className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-2">{field}</p>
              <input 
                type="text"
                placeholder={`Enter ${field}...`}
                value={customFields[field] || ''}
                onChange={(e) => setCustomFields({ ...customFields, [field]: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm focus:border-accent outline-none"
              />
            </div>
          ))}
        </div>
      )}

      <button 
        onClick={handleSave}
        disabled={isSaving}
        className={cn(
          "w-full py-5 rounded-[24px] font-bold text-lg active:scale-95 transition-all shadow-lg shadow-accent/20",
          isSaving ? "bg-accent/50 text-white/50 cursor-not-allowed" : "bg-accent text-white"
        )}
      >
        {isSaving ? "Saving..." : "Complete & Save Bill"}
      </button>
    </div>
  );
};

const BillsView = ({ bills, deleteBill, settings, orders, setViewingOrder, setToast, setViewingBill }: any) => {
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [isExporting, setIsExporting] = useState(false);

  const filteredBills = bills.filter((b: any) => {
    if (!dateRange.start && !dateRange.end) return true;
    const billDate = new Date(b.timestamp).toISOString().split('T')[0];
    const start = dateRange.start || '0000-00-00';
    const end = dateRange.end || '9999-99-99';
    return billDate >= start && billDate <= end;
  }).sort((a: any, b: any) => b.timestamp - a.timestamp);

  const viewOrder = (e: React.MouseEvent, bill: any) => {
    e.stopPropagation();
    const order = orders.find((o: any) => o.id === bill.orderId);
    if (order) {
      setViewingOrder(order);
    } else {
      setToast({ message: "Corresponding Order for Bill was Deleted or Missing" });
    }
  };

  const exportPDF = async () => {
    setIsExporting(true);
    const doc = new jsPDF('p', 'mm', 'a4');
    const billsPerPage = 4;
    
    for (let i = 0; i < filteredBills.length; i += billsPerPage) {
      if (i > 0) doc.addPage();
      
      const pageBills = filteredBills.slice(i, i + billsPerPage);
      
      for (let j = 0; j < pageBills.length; j++) {
        const bill = pageBills[j];
        const col = j % 2;
        const row = Math.floor(j / 2);
        const xOffset = col * 105;
        const yOffset = row * 148.5;
        
        // Brand Background
        if (settings.companyLogo) {
          doc.setGState(new (doc as any).GState({ opacity: 0.13 }));
          doc.addImage(settings.companyLogo, 'PNG', xOffset + 27.5, yOffset + 40, 50, 50);
          doc.setGState(new (doc as any).GState({ opacity: 1 }));
        }

        doc.setDrawColor(220);
        doc.setLineWidth(0.1);
        doc.rect(xOffset + 5, yOffset + 5, 95, 138.5);
        
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(settings.billHeader, xOffset + 10, yOffset + 15);
        doc.setFontSize(10);
        doc.text(`Order #${bill.orderNo}`, xOffset + 10, yOffset + 22);
        
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100);
        doc.text(format(bill.timestamp, 'yyyy-MM-dd HH:mm'), xOffset + 10, yOffset + 28);
        doc.setTextColor(0);
        
        doc.setDrawColor(240);
        doc.line(xOffset + 10, yOffset + 32, xOffset + 95, yOffset + 32);

        let itemY = yOffset + 38;
        bill.items.slice(0, 8).forEach((item: any) => {
          const itemSubtotal = (item.price * item.quantity) + item.extras.reduce((s:any,e:any)=>s+(e.price*e.quantity),0);
          
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.text(`${item.quantity}x ${item.name}`, xOffset + 10, itemY);
          doc.setFont('helvetica', 'normal');
          doc.text(formatCurrency(itemSubtotal), xOffset + 95, itemY, { align: 'right' });
          
          itemY += 6;
        });
        
        if (bill.items.length > 8) {
          doc.setFontSize(7);
          doc.setTextColor(150);
          doc.text(`...and ${bill.items.length - 8} more items`, xOffset + 10, itemY);
          doc.setTextColor(0);
        }
        
        const summaryY = yOffset + 105;
        doc.setDrawColor(240);
        doc.line(xOffset + 10, summaryY - 5, xOffset + 95, summaryY - 5);

        doc.setFontSize(8);
        doc.text(`Subtotal:`, xOffset + 10, summaryY);
        doc.text(formatCurrency(bill.subtotal), xOffset + 95, summaryY, { align: 'right' });
        
        const discAmt = bill.discount.type === 'percent' ? (bill.subtotal * (bill.discount.value / 100)) : bill.discount.value;
        doc.text(`Discount:`, xOffset + 10, summaryY + 5);
        doc.text(`-${formatCurrency(discAmt)}`, xOffset + 95, summaryY + 5, { align: 'right' });
        
        doc.text(`Tax (${bill.taxPercent}%):`, xOffset + 10, summaryY + 10);
        doc.text(`+${formatCurrency((bill.subtotal - discAmt) * (bill.taxPercent / 100))}`, xOffset + 95, summaryY + 10, { align: 'right' });
        
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(settings.accentColor);
        doc.text(`TOTAL:`, xOffset + 10, summaryY + 18);
        doc.text(formatCurrency(bill.total), xOffset + 95, summaryY + 18, { align: 'right' });
        doc.setTextColor(0);
        
        doc.setFontSize(7);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(150);
        const splitFooter = doc.splitTextToSize(settings.billFooter, 85);
        doc.text(splitFooter, xOffset + 10, yOffset + 130);
        doc.setTextColor(0);

        if (!bill.isSold) {
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(255, 0, 0);
          doc.text("NOT SOLD", xOffset + 10, summaryY + 25);
          doc.setTextColor(0, 0, 0);
        }
      }
    }
    
    doc.save(`bills_export_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
    setIsExporting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tighter">Bills</h1>
        <button 
          onClick={exportPDF}
          disabled={isExporting || filteredBills.length === 0}
          className="bg-white/5 border border-white/10 p-2.5 rounded-xl flex items-center gap-2 text-xs font-bold disabled:opacity-50"
        >
          <Download size={16} />
          {isExporting ? 'Exporting...' : 'Export PDF'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-[8px] font-bold uppercase tracking-widest text-white/40 ml-1">From</p>
          <input type="date" value={dateRange.start} onChange={e => setDateRange({ ...dateRange, start: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-[10px] outline-none" />
        </div>
        <div className="space-y-1">
          <p className="text-[8px] font-bold uppercase tracking-widest text-white/40 ml-1">To</p>
          <input type="date" value={dateRange.end} onChange={e => setDateRange({ ...dateRange, end: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-[10px] outline-none" />
        </div>
      </div>

      <motion.div 
        initial="hidden"
        animate="visible"
        variants={{
          visible: {
            transition: {
              staggerChildren: 0.05
            }
          }
        }}
        className="space-y-3"
      >
        {filteredBills.map((bill: any) => (
          <motion.div 
            key={bill.id}
            variants={{
              hidden: { opacity: 0, y: 10 },
              visible: { opacity: 1, y: 0 }
            }}
            onClick={() => setViewingBill(bill)}
            className={cn(
              "bg-white/5 border rounded-[20px] p-4 space-y-3 relative overflow-hidden active:scale-[0.98] transition-all",
              bill.isSold ? "border-white/10" : "border-red-500/50"
            )}
          >
            {!bill.isSold && (
              <div className="absolute top-0 right-0 bg-red-500 text-white text-[8px] font-bold px-2 py-0.5 rounded-bl-lg uppercase tracking-widest">
                Not Sold
              </div>
            )}
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Bill #{bill.orderNo}</p>
                <p className="text-base font-bold text-accent">{formatCurrency(bill.total)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-white/40">{format(bill.timestamp, 'MMM d, HH:mm')}</p>
              </div>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-white/5">
              <p className="text-[10px] text-white/40">{bill.items.length} Items</p>
              <div className="flex gap-1.5">
                <button 
                  onClick={(e) => viewOrder(e, bill)}
                  className="bg-white/10 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold"
                >
                  View Order
                </button>
                <button onClick={(e) => { e.stopPropagation(); deleteBill(bill.id); }} className="p-1.5 text-red-500/50 hover:text-red-500 transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
};

const SortableManageItem = ({ item, setEditingItem, deleteMenuItem, formatCurrency }: any) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div 
      ref={setNodeRef}
      style={style}
      className="bg-white/5 border border-white/10 rounded-2xl p-4 flex justify-between items-center select-none"
    >
      <div className="flex items-center gap-4">
        <div 
          {...attributes} 
          {...listeners}
          className="p-2 bg-white/5 rounded-lg text-white/20 hover:text-white/60 cursor-grab active:cursor-grabbing"
        >
          <GripVertical size={18} />
        </div>
        <div className="w-12 h-12 rounded-xl bg-white/5 overflow-hidden flex-shrink-0">
          {item.image ? <img src={item.image} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-white/10"><UtensilsCrossed size={20} /></div>}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-sm truncate">{item.name}</p>
          <p className="text-accent font-bold text-xs">{formatCurrency(item.price)}</p>
        </div>
      </div>
      <div className="flex gap-1">
        <button onClick={() => setEditingItem(item)} className="p-2 text-white/40 hover:text-white transition-colors"><ChevronRight size={20} /></button>
        <button onClick={() => deleteMenuItem(item.id)} className="p-2 text-red-500/40 hover:text-red-500 transition-colors"><Trash2 size={20} /></button>
      </div>
    </div>
  );
};

const ManageMenuView = ({ menu, setMenu, setEditingItem, deleteMenuItem, formatCurrency }: any) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = menu.findIndex((i: any) => i.id === active.id);
      const newIndex = menu.findIndex((i: any) => i.id === over.id);
      const newMenu = arrayMove(menu, oldIndex, newIndex);
      
      const db = await getDB();
      const updatedMenu = newMenu.map((item: any, idx: number) => ({
        ...item,
        customOrder: idx
      }));
      
      const tx = db.transaction('menu', 'readwrite');
      await Promise.all(updatedMenu.map(item => tx.store.put(item)));
      await tx.done;
      
      setMenu(updatedMenu);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold uppercase tracking-widest text-white/40">Menu Items ({menu.length})</h3>
        <button 
          onClick={() => setEditingItem({ id: crypto.randomUUID(), name: '', price: 0, prepTime: 15, category: '', extras: [], createdAt: Date.now(), customOrder: menu.length })}
          className="bg-accent text-white px-4 py-2 rounded-xl text-xs font-bold"
        >
          Add New
        </button>
      </div>
      
      <DndContext 
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext 
          items={menu.map((i: any) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-3">
            {menu.map((item: any) => (
              <SortableManageItem 
                key={item.id} 
                item={item} 
                setEditingItem={setEditingItem} 
                deleteMenuItem={deleteMenuItem} 
                formatCurrency={formatCurrency}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
};

const SortableMenuItem = ({ item, setEditingItem }: any) => {
  return (
    <motion.div 
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0 }
      }}
      className="bg-white/5 border border-white/10 rounded-[20px] overflow-hidden group relative"
    >
      <div className="aspect-square bg-white/5 relative">
        {item.image ? (
          <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/10">
            <UtensilsCrossed size={32} />
          </div>
        )}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
          <button onClick={() => setEditingItem(item)} className="p-2.5 bg-white/10 rounded-full hover:bg-accent transition-colors"><SettingsIcon size={18} /></button>
        </div>
        <button 
          onClick={(e) => { e.stopPropagation(); setEditingItem(item); }}
          className="absolute top-2 right-2 p-2 bg-black/40 blur-overlay rounded-full text-white md:hidden"
        >
          <SettingsIcon size={14} />
        </button>
      </div>
      <div className="p-3">
        <p className="font-bold text-sm truncate">{item.name}</p>
        <p className="text-accent font-bold text-xs">{formatCurrency(item.price)}</p>
      </div>
    </motion.div>
  );
};

const MenuView = ({ menu, setMenu, setEditingItem, deleteItem, settings, saveSettings, sortMenu, setIsMenuModalOpen }: any) => {
  const [activeCategory, setActiveCategory] = useState('All');
  const categories = ['All', ...Array.from(new Set(menu.map((item: any) => item.category).filter(Boolean)))];
  
  const sortedMenu = sortMenu(menu, settings.menuSortMethod, settings.menuSortDirection);
  const filteredMenu = activeCategory === 'All' 
    ? sortedMenu 
    : sortedMenu.filter((item: any) => item.category === activeCategory);

  const toggleSortDirection = () => {
    saveSettings({
      ...settings,
      menuSortDirection: settings.menuSortDirection === 'asc' ? 'desc' : 'asc'
    });
  };

  const setSortMethod = (method: Settings['menuSortMethod']) => {
    saveSettings({
      ...settings,
      menuSortMethod: method
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tighter">Menu</h1>
        <div className="flex gap-2">
          <button 
            onClick={() => setIsMenuModalOpen(true)}
            className="bg-white/5 border border-white/10 text-white px-4 py-2 rounded-xl text-xs font-bold active:scale-95 transition-all"
          >
            Manage
          </button>
          <button 
            onClick={() => setEditingItem({ id: crypto.randomUUID(), name: '', price: 0, prepTime: 15, category: '', extras: [], createdAt: Date.now(), customOrder: menu.length })}
            className="bg-accent text-white p-2.5 rounded-xl shadow-lg shadow-accent/20 active:scale-95 transition-all"
          >
            <Plus size={20} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {categories.map(cat => (
            <button
              key={cat as string}
              onClick={() => setActiveCategory(cat as string)}
              className={cn(
                "px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all whitespace-nowrap",
                activeCategory === cat ? "bg-accent border-accent text-white" : "bg-white/5 border-white/10 text-white/50"
              )}
            >
              {cat as string}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between bg-white/5 p-2 rounded-2xl border border-white/5">
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {(['custom', 'alphabetical', 'category', 'recent'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setSortMethod(m)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all whitespace-nowrap",
                  settings.menuSortMethod === m ? "bg-accent text-white" : "text-white/40 hover:text-white/60"
                )}
              >
                {m}
              </button>
            ))}
          </div>
          {settings.menuSortMethod !== 'custom' && (
            <button 
              onClick={toggleSortDirection}
              className="p-2 bg-white/5 rounded-xl text-accent hover:bg-white/10 transition-colors"
            >
              {settings.menuSortDirection === 'asc' ? <ArrowUpAZ size={16} /> : <ArrowDownZA size={16} />}
            </button>
          )}
        </div>
      </div>

      <motion.div 
        initial="hidden"
        animate="visible"
        variants={{
          visible: {
            transition: {
              staggerChildren: 0.05
            }
          }
        }}
        className="grid grid-cols-2 gap-3"
      >
        {filteredMenu.map((item: any) => (
          <SortableMenuItem 
            key={item.id} 
            item={item} 
            setEditingItem={setEditingItem} 
          />
        ))}
      </motion.div>
    </div>
  );
};

const MenuItemForm = ({ item, onSave, onCancel, onDelete }: any) => {
  const [formData, setFormData] = useState<MenuItem>(item || { id: crypto.randomUUID(), name: '', price: 0, prepTime: 15, category: '', extras: [], createdAt: Date.now(), customOrder: 0 });
  const [newExtra, setNewExtra] = useState({ name: '', price: 0 });

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData({ ...formData, image: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <label className="relative w-32 h-32 rounded-[32px] bg-white/5 border-2 border-dashed border-white/10 flex flex-col items-center justify-center cursor-pointer overflow-hidden hover:border-accent transition-colors">
          {formData.image ? (
            <img src={formData.image} className="w-full h-full object-cover" />
          ) : (
            <>
              <ImageIcon size={32} className="text-white/20" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/20 mt-2">Upload</span>
            </>
          )}
          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </label>
        {item && (
          <button 
            onClick={() => {
              onDelete(item.id);
              onCancel();
            }}
            className="p-3 bg-red-500/10 text-red-500 rounded-2xl hover:bg-red-500 hover:text-white transition-all"
          >
            <Trash2 size={24} />
          </button>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-2">Name</p>
          <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm focus:border-accent outline-none" />
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-2">Category</p>
          <input type="text" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm focus:border-accent outline-none" placeholder="e.g. Burgers, Drinks..." />
        </div>
        <div className="flex gap-4">
          <div className="flex-1 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-2">Price (PKR)</p>
            <input type="number" value={formData.price} onChange={e => setFormData({ ...formData, price: Number(e.target.value) })} className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm focus:border-accent outline-none" />
          </div>
          <div className="flex-1 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-2">Prep Time (min)</p>
            <input type="number" value={formData.prepTime} onChange={e => setFormData({ ...formData, prepTime: Number(e.target.value) })} className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm focus:border-accent outline-none" />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-white/40">Extras</h3>
        <div className="space-y-2">
          {formData.extras.map((extra, idx) => (
            <div key={idx} className="flex justify-between items-center bg-white/5 p-3 rounded-xl border border-white/5">
              <span className="text-sm font-bold">{extra.name} (+{formatCurrency(extra.price)})</span>
              <button onClick={() => setFormData({ ...formData, extras: formData.extras.filter((_, i) => i !== idx) })} className="text-red-500/50"><X size={16} /></button>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <input type="text" placeholder="Extra Name" value={newExtra.name} onChange={e => setNewExtra({ ...newExtra, name: e.target.value })} className="flex-[2] bg-white/5 border border-white/10 rounded-xl p-3 text-xs outline-none" />
            <input type="number" placeholder="Price" value={newExtra.price} onChange={e => setNewExtra({ ...newExtra, price: Number(e.target.value) })} className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-xs outline-none" />
            <button onClick={() => {
              if (newExtra.name) {
                setFormData({ ...formData, extras: [...formData.extras, newExtra] });
                setNewExtra({ name: '', price: 0 });
              }
            }} className="bg-accent p-3 rounded-xl"><Plus size={16} /></button>
          </div>
        </div>
      </div>

      <div className="flex gap-4 pt-4">
        <button onClick={onCancel} className="flex-1 bg-white/5 py-4 rounded-2xl font-bold text-sm">Cancel</button>
        <button onClick={() => onSave(formData)} className="flex-1 bg-accent py-4 rounded-2xl font-bold text-sm">Save Item</button>
      </div>
    </div>
  );
};

const SettingsView = ({ settings, saveSettings, bills, setBills, menu, setMenu, orders, setOrders }: any) => {
  const [formData, setFormData] = useState<Settings>(settings);
  const [newField, setNewField] = useState('');

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData({ ...formData, companyLogo: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const exportData = () => {
    const data = JSON.stringify({ bills, settings, menu, orders });
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inigma_full_backup_${format(new Date(), 'yyyyMMdd')}.json`;
    a.click();
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const data = JSON.parse(reader.result as string);
          const db = await getDB();

          if (data.menu) {
            const tx = db.transaction('menu', 'readwrite');
            await Promise.all(data.menu.map((m: any) => tx.store.put(m)));
            await tx.done;
            setMenu(data.menu);
          }
          if (data.orders) {
            const tx = db.transaction('orders', 'readwrite');
            await Promise.all(data.orders.map((o: any) => tx.store.put(o)));
            await tx.done;
            setOrders(data.orders);
          }
          if (data.bills) {
            const tx = db.transaction('bills', 'readwrite');
            await Promise.all(data.bills.map((b: any) => tx.store.put(b)));
            await tx.done;
            setBills(data.bills);
          }
          if (data.settings) {
            await saveSettings(data.settings);
            setFormData(data.settings);
          }
        } catch (err) {
          console.error('Failed to import data', err);
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <h1 className="text-3xl font-bold tracking-tighter">Settings</h1>
      
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <button onClick={exportData} className="bg-white/5 border border-white/10 p-4 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm">
            <Download size={18} /> Export Data
          </button>
          <label className="bg-white/5 border border-white/10 p-4 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm cursor-pointer">
            <Plus size={18} /> Import Data
            <input type="file" accept=".json" className="hidden" onChange={importData} />
          </label>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/40">Branding & Theme</h3>
          <div className="flex items-center gap-6">
            <label className="relative w-24 h-24 rounded-[24px] bg-white/5 border-2 border-dashed border-white/10 flex flex-col items-center justify-center cursor-pointer overflow-hidden">
              {formData.companyLogo ? (
                <img src={formData.companyLogo} className="w-full h-full object-cover" />
              ) : (
                <ImageIcon size={24} className="text-white/20" />
              )}
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            </label>
            <div className="flex-1 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-widest text-white/40">Theme</span>
                <div className="flex bg-white/5 rounded-lg p-1">
                  <button 
                    onClick={() => setFormData({ ...formData, theme: 'dark' })}
                    className={cn("px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all", formData.theme === 'dark' ? "bg-accent text-white" : "text-white/40")}
                  >Dark</button>
                  <button 
                    onClick={() => setFormData({ ...formData, theme: 'light' })}
                    className={cn("px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all", formData.theme === 'light' ? "bg-accent text-white" : "text-white/40")}
                  >Light</button>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-widest text-white/40">Accent</span>
                <input type="color" value={formData.accentColor} onChange={e => setFormData({ ...formData, accentColor: e.target.value })} className="w-10 h-10 rounded-lg bg-transparent border-none cursor-pointer" />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-widest text-white/40">Dark BG</span>
                <input type="color" value={formData.bgColor} onChange={e => setFormData({ ...formData, bgColor: e.target.value })} className="w-10 h-10 rounded-lg bg-transparent border-none cursor-pointer" />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-widest text-white/40">Light BG</span>
                <input type="color" value={formData.lightBgColor} onChange={e => setFormData({ ...formData, lightBgColor: e.target.value })} className="w-10 h-10 rounded-lg bg-transparent border-none cursor-pointer" />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-widest text-white/40">Border Radius</span>
                  <span className="text-xs font-bold">{formData.borderRadius}px</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="40" 
                  value={formData.borderRadius} 
                  onChange={e => setFormData({ ...formData, borderRadius: Number(e.target.value) })} 
                  className="w-full accent-accent h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/40">Bill Customization</h3>
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-2">Header</p>
              <input type="text" value={formData.billHeader} onChange={e => setFormData({ ...formData, billHeader: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm outline-none" />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-2">Footer</p>
              <input type="text" value={formData.billFooter} onChange={e => setFormData({ ...formData, billFooter: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm outline-none" />
            </div>
            <div className="flex gap-4">
              <div className="flex-1 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-2">Default Tax %</p>
                <input type="number" value={formData.defaultTax} onChange={e => setFormData({ ...formData, defaultTax: Number(e.target.value) })} className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm outline-none" />
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-2">Alert Threshold %</p>
                <input type="number" value={formData.notificationThreshold} onChange={e => setFormData({ ...formData, notificationThreshold: Number(e.target.value) })} className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm outline-none" />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/40">Billing Alerts</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-white/5 p-4 rounded-xl border border-white/10">
              <span className="text-xs font-bold uppercase tracking-widest text-white/40">Enable Billing Alerts</span>
              <button 
                onClick={() => setFormData({ ...formData, enableBillingAlerts: !formData.enableBillingAlerts })}
                className={cn("w-12 h-6 rounded-full transition-all relative", formData.enableBillingAlerts ? "bg-accent" : "bg-white/10")}
              >
                <div className={cn("absolute top-1 w-4 h-4 rounded-full bg-white transition-all", formData.enableBillingAlerts ? "right-1" : "left-1")} />
              </button>
            </div>
            <div className="flex gap-4">
              <div className="flex-1 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-2">First Alert (min)</p>
                <input type="number" value={formData.billingAlertThreshold} onChange={e => setFormData({ ...formData, billingAlertThreshold: Number(e.target.value) })} className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm outline-none" />
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 ml-2">Repeat Interval (min)</p>
                <input type="number" value={formData.billingRepeatInterval} onChange={e => setFormData({ ...formData, billingRepeatInterval: Number(e.target.value) })} className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm outline-none" />
              </div>
            </div>
            <p className="text-[10px] text-white/30 italic px-2">
              * Subsequent reminders will repeat every {formData.billingRepeatInterval / 4} minutes after the second alert.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/40">Custom Bill Fields</h3>
          <div className="max-h-[200px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
            {formData.customBillFields.map((field, idx) => (
              <div key={idx} className="flex justify-between items-center bg-white/5 p-3 rounded-xl border border-white/5">
                <span className="text-sm font-bold">{field}</span>
                <button onClick={() => setFormData({ ...formData, customBillFields: formData.customBillFields.filter((_, i) => i !== idx) })} className="text-red-500/50"><X size={16} /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input type="text" placeholder="Add custom field..." value={newField} onChange={e => setNewField(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 text-sm outline-none" />
            <button onClick={() => {
              if (newField) {
                setFormData({ ...formData, customBillFields: [...formData.customBillFields, newField] });
                setNewField('');
              }
            }} className="bg-accent p-4 rounded-xl"><Plus size={20} /></button>
          </div>
        </div>
      </div>

      <button 
        onClick={() => saveSettings(formData)}
        className="w-full bg-accent text-white py-5 rounded-[24px] font-bold text-lg active:scale-95 transition-all shadow-lg shadow-accent/20"
      >
        Save All Settings
      </button>
    </div>
  );
};
