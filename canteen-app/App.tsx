import { StatusBar } from 'expo-status-bar';
import * as SQLite from 'expo-sqlite';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { makeOrderPrintJob, makePrinterTestJob, makeReportPrintJob, sendBluetoothPrintJob, sendPrintJob } from './printer/escpos';

type MenuItem = { id: number; name: string; price: number; active: number };
type Line = { item: MenuItem; quantity: number };
type ReportRow = { name: string; quantity: number; revenue: number };
type SavedOrder = { id: number; token: number; total: number; created_at: string };
type SavedOrderItem = { id: number; token: number; item_name: string; unit_price: number; quantity: number };
type HistoryOrder = SavedOrder & { items: SavedOrderItem[] };
type ReceiptData = { token: number; total: number; created_at: string; items: SavedOrderItem[] };
type PurchaseItem = { id: number; name: string; unit: 'kg' | 'items' };
type PurchaseRow = { id: number; item_name: string; quantity: number; unit: string; total_cost: number; purchase_date: string };
type BluetoothDevice = { id: string; name?: string | null; bondState?: string };
type AppTab = 'order' | 'history' | 'menu' | 'inventory' | 'report' | 'analysis' | 'printer';
const stockItems: PurchaseItem[] = [
  { id: 1, name: 'Sandwich bread', unit: 'items' }, { id: 2, name: 'Panipuri Puri', unit: 'items' },
  { id: 3, name: 'Besan (Chana lot)', unit: 'kg' }, { id: 4, name: 'Pau - Dabeli/Vadapau', unit: 'items' },
  { id: 5, name: 'Red chilli sauce', unit: 'items' }, { id: 6, name: 'Tomato sauce', unit: 'items' },
  { id: 7, name: 'Dabeli masalo', unit: 'items' }, { id: 8, name: 'Nylon sev', unit: 'kg' },
  { id: 9, name: 'Masala sing', unit: 'kg' }, { id: 10, name: 'Pumpkin sauce', unit: 'items' },
  { id: 11, name: 'Panipuri glass', unit: 'items' }, { id: 12, name: 'Paper Dish', unit: 'items' },
  { id: 13, name: 'Potato', unit: 'kg' }, { id: 14, name: 'Puff', unit: 'items' },
];
const db = SQLite.openDatabaseSync('canteen.db');
const menuImages: Record<string, number> = {
  bhel: require('./assets/menu/bhel.png'),
  bhajia: require('./assets/menu/bhajia.png'),
  dabeli: require('./assets/menu/dabeli.png'),
  panipuri: require('./assets/menu/panipuri.png'),
  sandwich: require('./assets/menu/sandwich.png'),
  vadapav: require('./assets/menu/vadapav.png'),
};
const menuImageFor = (name: string) => menuImages[name.trim().toLowerCase()];
const money = (value: number) => `₹${value.toFixed(2)}`;
const displayPurchaseUnit = (unit: string) => unit === 'kg' ? 'kg' : 'Item number/packets';
const isValidDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function CanteenApp() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<AppTab>('order');
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [historyOrders, setHistoryOrders] = useState<HistoryOrder[]>([]);
  const [orderCount, setOrderCount] = useState(0);
  const [modal, setModal] = useState(false);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [reportDate, setReportDate] = useState(today());
  const [rangeStart, setRangeStart] = useState(today().slice(0, 8) + '01');
  const [rangeEnd, setRangeEnd] = useState(today());
  const [rangeSales, setRangeSales] = useState(0);
  const [rangeOrders, setRangeOrders] = useState(0);
  const [rangeCost, setRangeCost] = useState(0);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>(stockItems);
  const [purchaseItemName, setPurchaseItemName] = useState('');
  const [purchaseUnit, setPurchaseUnit] = useState<'kg' | 'items'>('kg');
  const [purchaseQuantity, setPurchaseQuantity] = useState('');
  const [purchaseCost, setPurchaseCost] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(today());
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseRow[]>([]);
  const [loadedReportDate, setLoadedReportDate] = useState(today());
  const [reportPreviewVisible, setReportPreviewVisible] = useState(false);
  const [addingToOrder, setAddingToOrder] = useState<number | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [receiptCopy, setReceiptCopy] = useState<'customer' | 'staff'>('customer');
  const [printerHost, setPrinterHost] = useState('');
  const [printerPort, setPrinterPort] = useState('9100');
  const [receiptSerialStart, setReceiptSerialStart] = useState('1');
  const [printerMode, setPrinterMode] = useState<'wifi' | 'bluetooth'>('wifi');
  const [bluetoothDeviceId, setBluetoothDeviceId] = useState('');
  const [bluetoothDeviceName, setBluetoothDeviceName] = useState('');
  const [bluetoothDevices, setBluetoothDevices] = useState<BluetoothDevice[]>([]);
  const [scanningBluetooth, setScanningBluetooth] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printerStatus, setPrinterStatus] = useState('');

  useEffect(() => {
    try {
      db.execSync(`PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS menu_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, token INTEGER NOT NULL, order_date TEXT NOT NULL, total REAL NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, item_name TEXT NOT NULL, unit_price REAL NOT NULL, quantity INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS daily_token_sequences (order_date TEXT PRIMARY KEY, last_token INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS app_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);`);
      db.execSync('CREATE TABLE IF NOT EXISTS inventory_purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, item_name TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL, total_cost REAL NOT NULL, purchase_date TEXT NOT NULL, created_at TEXT NOT NULL)');
      const orderItemColumns = db.getAllSync<{ name: string }>('PRAGMA table_info(order_items)');
      if (!orderItemColumns.some(column => column.name === 'token')) db.execSync('ALTER TABLE order_items ADD COLUMN token INTEGER');
      // Preserve the highest number already used, then make every line use its order's shared token.
      db.withTransactionSync(() => {
        const dates = db.getAllSync<{ order_date: string; max_token: number }>(`SELECT o.order_date, MAX(MAX(o.token, COALESCE(oi.token, 0))) AS max_token FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id GROUP BY o.order_date`);
        for (const row of dates) {
          const existing = db.getFirstSync<{ last_token: number }>('SELECT last_token FROM daily_token_sequences WHERE order_date = ?', row.order_date)?.last_token ?? 0;
          db.runSync('INSERT INTO daily_token_sequences (order_date, last_token) VALUES (?, ?) ON CONFLICT(order_date) DO UPDATE SET last_token = MAX(last_token, excluded.last_token)', row.order_date, Math.max(existing, row.max_token));
        }
        db.runSync('UPDATE order_items SET token = (SELECT token FROM orders WHERE orders.id = order_items.order_id)');
      });
      const unnumberedItems = db.getAllSync<{ id: number; order_date: string }>('SELECT oi.id, o.order_date FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.token IS NULL ORDER BY o.order_date, o.id, oi.id');
      if (unnumberedItems.length) db.withTransactionSync(() => {
        const nextByDate = new Map<string, number>();
        for (const item of unnumberedItems) {
          let next = nextByDate.get(item.order_date);
          if (next === undefined) {
            const last = db.getFirstSync<{ last_token: number }>('SELECT last_token FROM daily_token_sequences WHERE order_date = ?', item.order_date)?.last_token
              ?? db.getFirstSync<{ n: number }>('SELECT COALESCE(MAX(token), 0) AS n FROM orders WHERE order_date = ?', item.order_date)?.n
              ?? 0;
            next = last;
          }
          next += 1;
          nextByDate.set(item.order_date, next);
          db.runSync('UPDATE order_items SET token = ? WHERE id = ?', next, item.id);
          db.runSync('INSERT INTO daily_token_sequences (order_date, last_token) VALUES (?, ?) ON CONFLICT(order_date) DO UPDATE SET last_token = excluded.last_token', item.order_date, next);
        }
      });
      const count = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM menu_items');
      if (!count?.n) db.withTransactionSync(() => {
        db.runSync('INSERT INTO menu_items (name, price) VALUES (?, ?)', 'Sandwich', 60);
        db.runSync('INSERT INTO menu_items (name, price) VALUES (?, ?)', 'Panipuri', 30);
        db.runSync('INSERT INTO menu_items (name, price) VALUES (?, ?)', 'Tea', 15);
      });
      const vadapavSeeded = db.getFirstSync<{ setting_value: string }>('SELECT setting_value FROM app_settings WHERE setting_key = ?', 'menu_seed_vadapav_v1')?.setting_value;
      if (!vadapavSeeded) db.withTransactionSync(() => {
        const existing = db.getFirstSync<{ id: number }>("SELECT id FROM menu_items WHERE lower(replace(trim(name), ' ', '')) = 'vadapav' LIMIT 1");
        if (existing) db.runSync("UPDATE menu_items SET name = 'Vadapav', price = 30, active = 1 WHERE id = ?", existing.id);
        else db.runSync("INSERT INTO menu_items (name, price) VALUES ('Vadapav', 30)");
        db.runSync("INSERT INTO app_settings (setting_key, setting_value) VALUES ('menu_seed_vadapav_v1', '1')");
      });
      const bhelSeeded = db.getFirstSync<{ setting_value: string }>('SELECT setting_value FROM app_settings WHERE setting_key = ?', 'menu_seed_bhel_v1')?.setting_value;
      if (!bhelSeeded) db.withTransactionSync(() => {
        const existing = db.getFirstSync<{ id: number }>("SELECT id FROM menu_items WHERE lower(trim(name)) = 'bhel' LIMIT 1");
        if (existing) db.runSync("UPDATE menu_items SET name = 'Bhel', price = 40, active = 1 WHERE id = ?", existing.id);
        else db.runSync("INSERT INTO menu_items (name, price) VALUES ('Bhel', 40)");
        db.runSync("INSERT INTO app_settings (setting_key, setting_value) VALUES ('menu_seed_bhel_v1', '1')");
      });
      setPrinterHost(db.getFirstSync<{ setting_value: string }>('SELECT setting_value FROM app_settings WHERE setting_key = ?', 'printer_host')?.setting_value ?? '');
      setPrinterPort(db.getFirstSync<{ setting_value: string }>('SELECT setting_value FROM app_settings WHERE setting_key = ?', 'printer_port')?.setting_value ?? '9100');
      setReceiptSerialStart(db.getFirstSync<{ setting_value: string }>('SELECT setting_value FROM app_settings WHERE setting_key = ?', 'receipt_serial_start')?.setting_value ?? '1');
      setPrinterMode(db.getFirstSync<{ setting_value: string }>('SELECT setting_value FROM app_settings WHERE setting_key = ?', 'printer_mode')?.setting_value === 'bluetooth' ? 'bluetooth' : 'wifi');
      setBluetoothDeviceId(db.getFirstSync<{ setting_value: string }>('SELECT setting_value FROM app_settings WHERE setting_key = ?', 'printer_bluetooth_device_id')?.setting_value ?? '');
      setBluetoothDeviceName(db.getFirstSync<{ setting_value: string }>('SELECT setting_value FROM app_settings WHERE setting_key = ?', 'printer_bluetooth_device_name')?.setting_value ?? '');
      refreshMenu(); refreshReport(today()); refreshHistory(); refreshPurchases(); refreshRangeReport(`${today().slice(0, 8)}01`, today()); setReady(true);
    } catch (e) { Alert.alert('Could not open local database', String(e)); }
  }, []);

  function refreshMenu() { setMenu(db.getAllSync<MenuItem>('SELECT * FROM menu_items WHERE active = 1 ORDER BY name COLLATE NOCASE')); }
  function refreshReport(day: string) {
    setRows(db.getAllSync<ReportRow>('SELECT item_name AS name, SUM(quantity) AS quantity, SUM(unit_price * quantity) AS revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.order_date = ? GROUP BY item_name ORDER BY item_name', day));
    setOrderCount(db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM orders WHERE order_date = ?', day)?.n ?? 0);
    setLoadedReportDate(day);
  }
  function refreshHistory() {
    const saved = db.getAllSync<SavedOrder>('SELECT id, token, total, created_at FROM orders WHERE order_date = ? ORDER BY token DESC', today());
    setHistoryOrders(saved.map(order => ({ ...order, items: db.getAllSync<SavedOrderItem>('SELECT id, token, item_name, unit_price, quantity FROM order_items WHERE order_id = ? ORDER BY id', order.id) })));
  }
  function refreshPurchases() {
    const known = db.getAllSync<{ item_name: string; unit: string }>('SELECT item_name, unit FROM inventory_purchases GROUP BY item_name ORDER BY item_name COLLATE NOCASE');
    const merged = [...stockItems];
    for (const item of known) if (!merged.some(stock => stock.name.toLowerCase() === item.item_name.toLowerCase())) merged.push({ id: merged.length + 1, name: item.item_name, unit: item.unit === 'kg' ? 'kg' : 'items' });
    setPurchaseItems(merged);
    setPurchaseHistory(db.getAllSync<PurchaseRow>('SELECT id, item_name, quantity, unit, total_cost, purchase_date FROM inventory_purchases ORDER BY purchase_date DESC, id DESC LIMIT 60'));
  }
  function refreshRangeReport(start: string, end: string) {
    if (!isValidDate(start) || !isValidDate(end) || start > end) { Alert.alert('Check report dates', 'Enter dates as YYYY-MM-DD and make sure the start date is not after the end date.'); return; }
    setRangeSales(db.getFirstSync<{ total: number }>('SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE order_date BETWEEN ? AND ?', start, end)?.total ?? 0);
    setRangeOrders(db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM orders WHERE order_date BETWEEN ? AND ?', start, end)?.n ?? 0);
    setRangeCost(db.getFirstSync<{ total: number }>('SELECT COALESCE(SUM(total_cost), 0) AS total FROM inventory_purchases WHERE purchase_date BETWEEN ? AND ?', start, end)?.total ?? 0);
  }
  function savePurchase() {
    const quantity = Number(purchaseQuantity.trim().replace(',', '.')); const cost = Number(purchaseCost.trim().replace(',', '.'));
    if (!isValidDate(purchaseDate) || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(cost) || cost < 0) { Alert.alert('Check purchase details', 'Enter a real date as YYYY-MM-DD, a quantity greater than zero, and a valid total price.'); return; }
    const itemName = purchaseItemName.trim();
    if (!itemName) { Alert.alert('Item name required', 'Enter or select an inventory item.'); return; }
    const unit = purchaseUnit;
    try {
      db.runSync('INSERT INTO inventory_purchases (item_name, quantity, unit, total_cost, purchase_date, created_at) VALUES (?, ?, ?, ?, ?, ?)', itemName, quantity, unit, cost, purchaseDate.trim(), new Date().toISOString());
    } catch (error) {
      Alert.alert('Could not save purchase', error instanceof Error ? error.message : String(error));
      return;
    }
    setPurchaseQuantity(''); setPurchaseCost(''); refreshPurchases(); refreshRangeReport(rangeStart, rangeEnd);
  }

  const cartLines = useMemo(() => menu.filter(i => (cart[i.id] ?? 0) > 0).map(item => ({ item, quantity: cart[item.id] })), [menu, cart]);
  const total = cartLines.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  const reportTotal = rows.reduce((sum, row) => sum + row.revenue, 0);
  const averageOrderAmount = orderCount > 0 ? reportTotal / orderCount : 0;
  const configuredReceiptStart = Number(receiptSerialStart);
  const currentLastToken = db.getFirstSync<{ last_token: number }>('SELECT last_token FROM daily_token_sequences WHERE order_date = ?', today())?.last_token ?? 0;
  const nextReceiptToken = Math.max(Number.isSafeInteger(configuredReceiptStart) && configuredReceiptStart > 0 ? configuredReceiptStart : 1, currentLastToken + 1);
  const purchaseSuggestions = purchaseItemName.trim() ? purchaseItems.filter(item => item.name.toLocaleLowerCase().includes(purchaseItemName.trim().toLocaleLowerCase())).slice(0, 8) : [];
  const setQuantity = (id: number, value: number) => setCart(old => ({ ...old, [id]: Math.max(0, value) }));

  async function saveOrder() {
    if (!cartLines.length || savingOrder) return;
    setSavingOrder(true);
    try {
      let savedReceipt: ReceiptData | null = null;
      const createdAt = new Date().toISOString();
      const orderTotal = total;
      const linesToSave = cartLines;
      await db.withExclusiveTransactionAsync(async txn => {
        const orderDate = today();
        const sequence = await txn.getFirstAsync<{ last_token: number }>('SELECT last_token FROM daily_token_sequences WHERE order_date = ?', orderDate);
        const configuredStart = Number(receiptSerialStart);
        const firstToken = Number.isSafeInteger(configuredStart) && configuredStart > 0 ? configuredStart : 1;
        const nextToken = sequence ? sequence.last_token + 1 : (await txn.getFirstAsync<{ n: number }>('SELECT COALESCE(MAX(token), 0) + 1 AS n FROM orders WHERE order_date = ?', orderDate))?.n ?? firstToken;
        const token = Math.max(firstToken, nextToken);
        await txn.runAsync('INSERT INTO daily_token_sequences (order_date, last_token) VALUES (?, ?) ON CONFLICT(order_date) DO UPDATE SET last_token = excluded.last_token', orderDate, token);
        const orderInsert = await txn.runAsync('INSERT INTO orders (token, order_date, total, created_at) VALUES (?, ?, ?, ?)', token, orderDate, orderTotal, createdAt);
        for (const { item, quantity } of linesToSave) {
          await txn.runAsync('INSERT INTO order_items (order_id, token, item_name, unit_price, quantity) VALUES (?, ?, ?, ?, ?)', orderInsert.lastInsertRowId, token, item.name, item.price, quantity);
        }
        savedReceipt = { token, total: orderTotal, created_at: createdAt, items: linesToSave.map(({ item, quantity }, index) => ({ id: index, token, item_name: item.name, unit_price: item.price, quantity })) };
      });
      setCart({}); refreshReport(today()); refreshHistory(); refreshRangeReport(rangeStart, rangeEnd);
      if (savedReceipt) { setReceiptCopy('customer'); setReceipt(savedReceipt); }
    } catch (e) { Alert.alert('Could not save order', String(e)); }
    finally { setSavingOrder(false); }
  }

  function openOrderReceipt(order: HistoryOrder) {
    setReceiptCopy('customer');
    setReceipt({ token: order.token, total: order.total, created_at: order.created_at, items: order.items.map(item => ({ ...item, token: order.token })) });
  }

  function savePrinterSettings() {
    const host = printerHost.trim();
    const port = Number(printerPort);
    if (!host) { Alert.alert('Printer IP required', 'Enter the IP address printed on the printer test page.'); return false; }
    if (!Number.isInteger(port) || port < 1 || port > 65535) { Alert.alert('Check printer port', 'Enter a port between 1 and 65535.'); return false; }
    db.runSync('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value', 'printer_host', host);
    db.runSync('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value', 'printer_port', String(port));
    setPrinterHost(host); setPrinterPort(String(port));
    setPrinterStatus(`Saved printer ${host}:${port}`);
    return true;
  }

  function saveReceiptSerialStart() {
    const serial = Number(receiptSerialStart.trim());
    if (!Number.isSafeInteger(serial) || serial < 1) {
      Alert.alert('Check starting serial number', 'Enter a whole number greater than zero, such as 1 or 500.');
      return;
    }
    let nextSerial = serial;
    db.withTransactionSync(() => {
      db.runSync('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value', 'receipt_serial_start', String(serial));
      const highestOrder = db.getFirstSync<{ n: number }>('SELECT COALESCE(MAX(token), 0) AS n FROM orders WHERE order_date = ?', today())?.n ?? 0;
      nextSerial = Math.max(serial, highestOrder + 1);
      db.runSync('INSERT INTO daily_token_sequences (order_date, last_token) VALUES (?, ?) ON CONFLICT(order_date) DO UPDATE SET last_token = excluded.last_token', today(), nextSerial - 1);
    });
    setReceiptSerialStart(String(serial));
    Alert.alert('Saved', `The next receipt token will be ${nextSerial}.`);
  }

  function savePrinterMode(mode: 'wifi' | 'bluetooth') {
    db.runSync('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value', 'printer_mode', mode);
    setPrinterMode(mode);
    setPrinterStatus(mode === 'bluetooth' ? 'Bluetooth selected.' : 'Wi-Fi selected.');
  }

  async function scanBluetoothPrinters() {
    try {
      // This native module is intentionally loaded on demand to keep Expo Go startup working.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bluetooth = require('react-native-bluetooth-ble') as {
        requestBluetoothPermission: () => Promise<boolean>;
        addEventListener: (event: string, callback: (device: BluetoothDevice) => void) => () => void;
        startClassicScan: () => void;
        stopClassicScan: () => void;
      };
      const granted = await bluetooth.requestBluetoothPermission();
      if (!granted) {
        Alert.alert('Bluetooth permission needed', 'Allow nearby-device permission to find the printer.');
        return;
      }
      setBluetoothDevices([]);
      setScanningBluetooth(true);
      setPrinterStatus('Searching for nearby Bluetooth printers…');
      const removeFoundListener = bluetooth.addEventListener('classicDeviceFound', device => {
        if (!device.id) return;
        setBluetoothDevices(current => current.some(item => item.id === device.id) ? current : [...current, device]);
      });
      const removeFinishedListener = bluetooth.addEventListener('classicScanFinished', () => {
        removeFoundListener(); removeFinishedListener(); setScanningBluetooth(false);
        setPrinterStatus('Bluetooth search finished. Select your printer below.');
      });
      const removeFailedListener = bluetooth.addEventListener('classicScanFailed', event => {
        const { message } = event as unknown as { message: string };
        removeFoundListener(); removeFinishedListener(); removeFailedListener(); setScanningBluetooth(false);
        setPrinterStatus('Bluetooth search failed.');
        Alert.alert('Bluetooth search failed', message);
      });
      bluetooth.startClassicScan();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPrinterStatus('Bluetooth is unavailable in this app build.');
      Alert.alert('Bluetooth unavailable', `${message}\n\nInstall a development build that includes the Bluetooth module.`);
    }
  }

  function selectBluetoothPrinter(device: BluetoothDevice) {
    const deviceName = device.name?.trim() || 'Bluetooth printer';
    db.runSync('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value', 'printer_bluetooth_device_id', device.id);
    db.runSync('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value', 'printer_bluetooth_device_name', deviceName);
    setBluetoothDeviceId(device.id); setBluetoothDeviceName(deviceName);
    setPrinterStatus(`Selected ${deviceName}.`);
  }

  async function sendToSelectedPrinter(data: Uint8Array) {
    if (printerMode === 'bluetooth') {
      if (!bluetoothDeviceId) throw new Error('Select a Bluetooth printer in the Printer tab first.');
      await sendBluetoothPrintJob(bluetoothDeviceId, data);
    } else {
      if (!printerHost.trim()) throw new Error('Enter and save the printer IP address in the Printer tab first.');
      const port = Number(printerPort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a printer port between 1 and 65535 in the Printer tab.');
      await sendPrintJob(printerHost.trim(), port, data);
    }
  }

  async function runPrinterTest() {
    if (printerMode === 'wifi' && !savePrinterSettings()) return;
    if (printerMode === 'bluetooth' && !bluetoothDeviceId) { Alert.alert('Select a printer', 'Search for and select the KP307 Bluetooth printer first.'); return; }
    setPrinting(true); setPrinterStatus('Connecting to printer…');
    try {
      await sendToSelectedPrinter(makePrinterTestJob());
      setPrinterStatus('Test print sent. Check the printer.');
      Alert.alert('Test print sent', 'Check the printer for the Trimandir Canteen test slip.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPrinterStatus('Could not connect to printer.');
      Alert.alert('Printer connection failed', `${message}\n\n${printerMode === 'wifi' ? 'Make sure the tablet and printer are on the same Wi-Fi and verify the printer IP and port.' : 'Make sure the printer is powered on and paired with this Android device.'}`);
    } finally { setPrinting(false); }
  }

  async function printReceiptSet() {
    if (!receipt) return;
    if (printerMode === 'bluetooth' && !bluetoothDeviceId) { Alert.alert('Set up the printer first', 'Open the Printer tab and select a Bluetooth printer.'); return; }
    if (printerMode === 'wifi' && (!printerHost.trim() || !Number.isInteger(Number(printerPort)) || Number(printerPort) < 1 || Number(printerPort) > 65535)) { Alert.alert('Set up the printer first', 'Open the Printer tab and enter a valid printer IP address and port.'); return; }
    setPrinting(true);
    try {
      await sendToSelectedPrinter(makeOrderPrintJob(receipt));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('Printing failed', `${message}\n\n${printerMode === 'wifi' ? 'Check that the tablet and printer are on the same Wi-Fi and confirm the printer IP and port.' : 'Check that the printer is powered on, paired, and selected in Printer setup.'}`);
    } finally { setPrinting(false); }
  }

  async function printReport() {
    if (printerMode === 'bluetooth' && !bluetoothDeviceId) { Alert.alert('Set up the printer first', 'Open the Printer tab and select a Bluetooth printer.'); return; }
    if (printerMode === 'wifi' && (!printerHost.trim() || !Number.isInteger(Number(printerPort)) || Number(printerPort) < 1 || Number(printerPort) > 65535)) { Alert.alert('Set up the printer first', 'Open the Printer tab and enter a valid printer IP address and port.'); return; }
    setPrinting(true);
    try {
      await sendToSelectedPrinter(makeReportPrintJob({ date: loadedReportDate, orders: orderCount, totalSales: reportTotal, averageOrderAmount, items: rows }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('Report printing failed', `${message}\n\nCheck the printer connection and settings in the Printer tab.`);
    } finally { setPrinting(false); }
  }

  function openEditor(item?: MenuItem) { setEditItem(item ?? null); setName(item?.name ?? ''); setPrice(item ? String(item.price) : ''); setModal(true); }
  function saveMenuItem() {
    const n = name.trim(); const p = Number(price);
    if (!n || !Number.isFinite(p) || p < 0) { Alert.alert('Check item details', 'Enter an item name and a valid price.'); return; }
    if (editItem) db.runSync('UPDATE menu_items SET name = ?, price = ? WHERE id = ?', n, p, editItem.id);
    else db.runSync('INSERT INTO menu_items (name, price) VALUES (?, ?)', n, p);
    setModal(false); refreshMenu();
  }
  function deactivate(item: MenuItem) { Alert.alert('Remove item?', `Hide ${item.name} from the menu? Past orders will remain in reports.`, [{ text: 'Cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { db.runSync('UPDATE menu_items SET active = 0 WHERE id = ?', item.id); refreshMenu(); } }]); }
  function refreshOrderChanges() { refreshHistory(); refreshReport(today()); refreshRangeReport(rangeStart, rangeEnd); }
  function changeSavedQuantity(order: HistoryOrder, line: SavedOrderItem, delta: number) {
    if (delta < 0 && line.quantity === 1 && order.items.length === 1) {
      cancelOrder(order);
      return;
    }
    db.withTransactionSync(() => {
      const next = line.quantity + delta;
      if (next <= 0) db.runSync('DELETE FROM order_items WHERE id = ?', line.id);
      else db.runSync('UPDATE order_items SET quantity = ? WHERE id = ?', next, line.id);
      const total = db.getFirstSync<{ total: number }>('SELECT COALESCE(SUM(unit_price * quantity), 0) AS total FROM order_items WHERE order_id = ?', order.id)?.total ?? 0;
      if (total <= 0) db.runSync('DELETE FROM orders WHERE id = ?', order.id);
      else db.runSync('UPDATE orders SET total = ? WHERE id = ?', total, order.id);
    });
    refreshOrderChanges();
  }
  function addMenuItemToOrder(orderId: number, item: MenuItem) {
    db.withTransactionSync(() => {
      const line = db.getFirstSync<{ id: number; quantity: number }>('SELECT id, quantity FROM order_items WHERE order_id = ? AND item_name = ? AND unit_price = ?', orderId, item.name, item.price);
      if (line) db.runSync('UPDATE order_items SET quantity = ? WHERE id = ?', line.quantity + 1, line.id);
      else {
        const orderToken = db.getFirstSync<{ token: number }>('SELECT token FROM orders WHERE id = ?', orderId)!.token;
        db.runSync('INSERT INTO order_items (order_id, token, item_name, unit_price, quantity) VALUES (?, ?, ?, ?, 1)', orderId, orderToken, item.name, item.price);
      }
      const total = db.getFirstSync<{ total: number }>('SELECT SUM(unit_price * quantity) AS total FROM order_items WHERE order_id = ?', orderId)?.total ?? 0;
      db.runSync('UPDATE orders SET total = ? WHERE id = ?', total, orderId);
    });
    setAddingToOrder(null); refreshOrderChanges();
  }
  function cancelOrder(order: SavedOrder) {
    Alert.alert('Cancel this order?', `Cancel this order (${money(order.total)})? Its item tokens will be removed from the report.`, [
      { text: 'Keep order', style: 'cancel' },
      { text: 'Cancel order', style: 'destructive', onPress: () => {
        db.withTransactionSync(() => {
          db.runSync('DELETE FROM order_items WHERE order_id = ?', order.id);
          db.runSync('DELETE FROM orders WHERE id = ?', order.id);
        });
        refreshOrderChanges();
      } },
    ]);
  }

  if (!ready) return <SafeAreaView style={s.center}><Text style={s.title}>Starting canteen app…</Text></SafeAreaView>;
  return <SafeAreaView style={s.safe}>
    <StatusBar style="dark" />
    <View style={s.header}><View><Text style={s.eyebrow}>TRIMANDIR CANTEEN</Text><Text style={s.title}>{tab === 'order' ? 'New order' : tab === 'history' ? 'Today’s history' : tab === 'menu' ? 'Menu' : tab === 'inventory' ? 'Inventory' : tab === 'analysis' ? 'Cost analysis' : tab === 'printer' ? 'Printer setup' : 'Sales report'}</Text></View><View style={s.localBadge}><View style={s.dot}/><Text style={s.localText}>ON DEVICE</Text></View></View>
    <ScrollView horizontal style={s.tabScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>{(['order', 'history', 'menu', 'inventory', 'report', 'analysis', 'printer'] as const).map(key => <TouchableOpacity key={key} onPress={() => setTab(key)} style={[s.tab, tab === key && s.tabActive]}><Text style={[s.tabText, tab === key && s.tabTextActive]}>{key === 'order' ? 'Order' : key === 'history' ? 'History' : key === 'menu' ? 'Menu' : key === 'inventory' ? 'Inventory' : key === 'analysis' ? 'Cost analysis' : key === 'printer' ? 'Printer' : 'Sales'}</Text></TouchableOpacity>)}</ScrollView>
    {tab === 'order' && <View style={s.body}><Text style={s.sectionTitle}>Tap items to add to the order</Text><Text style={s.nextTokenHint}>Next receipt token: #{nextReceiptToken}</Text><FlatList data={menu} keyExtractor={x => String(x.id)} contentContainerStyle={s.list} renderItem={({ item }) => <View style={s.itemRow}>{menuImageFor(item.name) ? <Image source={menuImageFor(item.name)} style={s.menuImage} resizeMode="contain" accessibilityLabel={`${item.name} photo`} /> : null}<View style={{ flex: 1 }}><Text style={s.itemName}>{item.name}</Text><Text style={s.itemPrice}>{money(item.price)}</Text></View><TouchableOpacity style={s.qtyButton} onPress={() => setQuantity(item.id, (cart[item.id] ?? 0) - 1)}><Text style={s.qtyLabel}>−</Text></TouchableOpacity><Text style={s.qty}>{cart[item.id] ?? 0}</Text><TouchableOpacity style={[s.qtyButton, s.qtyAdd]} onPress={() => setQuantity(item.id, (cart[item.id] ?? 0) + 1)}><Text style={[s.qtyLabel, { color: '#fff' }]}>+</Text></TouchableOpacity></View>} />
      <View style={s.cart}><View style={s.totalRow}><Text style={s.totalLabel}>Order total</Text><Text style={s.total}>{money(total)}</Text></View><TouchableOpacity style={[s.primary, (!cartLines.length || savingOrder) && s.disabled]} disabled={!cartLines.length || savingOrder} onPress={saveOrder}><Text style={s.primaryText}>{savingOrder ? 'Saving…' : 'Save order'}</Text></TouchableOpacity><Text style={s.hint}>Token number is assigned when saved. Configure printing in the Printer tab.</Text></View></View>}
    {tab === 'menu' && <View style={s.body}><View style={s.toolbar}><Text style={s.sectionTitle}>Items & prices</Text><TouchableOpacity style={s.smallPrimary} onPress={() => openEditor()}><Text style={s.primaryText}>＋ Add item</Text></TouchableOpacity></View><FlatList data={menu} keyExtractor={x => String(x.id)} contentContainerStyle={s.list} renderItem={({ item }) => <View style={s.itemRow}>{menuImageFor(item.name) ? <Image source={menuImageFor(item.name)} style={s.menuImage} resizeMode="contain" accessibilityLabel={`${item.name} photo`} /> : null}<View style={{ flex: 1 }}><Text style={s.itemName}>{item.name}</Text><Text style={s.itemPrice}>{money(item.price)}</Text></View><TouchableOpacity style={s.action} onPress={() => openEditor(item)}><Text style={s.actionText}>Edit</Text></TouchableOpacity><TouchableOpacity style={s.action} onPress={() => deactivate(item)}><Text style={[s.actionText, { color: '#a94737' }]}>Remove</Text></TouchableOpacity></View>} ListEmptyComponent={<Text style={s.hint}>Add your first menu item.</Text>} /></View>}
    {tab === 'history' && <View style={s.body}><Text style={s.sectionTitle}>Today · {today()}</Text><ScrollView style={{ flex: 1 }}>{historyOrders.map(order => <View key={order.id} style={s.historyCard}><View style={s.totalRow}><View><Text style={s.orderToken}>Order #{order.token}</Text><Text style={s.itemPrice}>{new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text></View><Text style={s.orderTotal}>{money(order.total)}</Text></View>{order.items.map(line => <View key={line.id} style={s.historyLine}><View style={{ flex: 1 }}><Text style={s.itemName}>#{order.token} · {line.item_name}</Text><Text style={s.itemPrice}>{money(line.unit_price)} each</Text></View><TouchableOpacity style={s.qtyButton} onPress={() => changeSavedQuantity(order, line, -1)}><Text style={s.qtyLabel}>−</Text></TouchableOpacity><Text style={s.qty}>{line.quantity}</Text><TouchableOpacity style={[s.qtyButton, s.qtyAdd]} onPress={() => changeSavedQuantity(order, line, 1)}><Text style={[s.qtyLabel, { color: '#fff' }]}>+</Text></TouchableOpacity></View>)}<TouchableOpacity style={s.receiptLink} onPress={() => openOrderReceipt(order)}><Text style={s.actionText}>View receipt</Text></TouchableOpacity><TouchableOpacity style={s.addToOrder} onPress={() => setAddingToOrder(order.id)}><Text style={s.actionText}>＋ Add menu item</Text></TouchableOpacity><TouchableOpacity style={s.cancelOrderButton} onPress={() => cancelOrder(order)}><Text style={s.deleteText}>Cancel entire order</Text></TouchableOpacity></View>)}{!historyOrders.length && <Text style={s.emptyHistory}>No orders yet today. New orders will appear here.</Text>}</ScrollView></View>}
    {tab === 'inventory' && <KeyboardAvoidingView style={s.body} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <Text style={s.sectionTitle}>Log stock received</Text>
      <Text style={s.fieldLabel}>Enter item name</Text><TextInput value={purchaseItemName} onChangeText={setPurchaseItemName} placeholder="Start typing an item name" style={s.input}/>
      {purchaseItemName.trim() ? <View style={s.suggestions}>{purchaseSuggestions.map(item => <TouchableOpacity key={item.name} onPress={() => { setPurchaseItemName(item.name); setPurchaseUnit(item.unit); }} style={s.suggestionRow}><Text style={s.itemName}>{item.name}</Text><Text style={s.itemPrice}>{displayPurchaseUnit(item.unit)}</Text></TouchableOpacity>)}{!purchaseSuggestions.some(item => item.name.toLocaleLowerCase() === purchaseItemName.trim().toLocaleLowerCase()) ? <Text style={s.newItemHint}>No match — “{purchaseItemName.trim()}” will be created with this purchase.</Text> : null}</View> : <Text style={s.hint}>Common items and items you have added will appear as you type.</Text>}
      <Text style={s.fieldLabel}>Unit</Text><View style={s.copyTabs}><TouchableOpacity style={[s.copyTab, purchaseUnit === 'kg' && s.copyTabActive]} onPress={() => setPurchaseUnit('kg')}><Text style={[s.copyTabText, purchaseUnit === 'kg' && s.copyTabTextActive]}>Kilograms (kg)</Text></TouchableOpacity><TouchableOpacity style={[s.copyTab, purchaseUnit === 'items' && s.copyTabActive]} onPress={() => setPurchaseUnit('items')}><Text style={[s.copyTabText, purchaseUnit === 'items' && s.copyTabTextActive]}>Item number/packets</Text></TouchableOpacity></View>
      <Text style={s.fieldLabel}>Purchase date (YYYY-MM-DD)</Text><TextInput value={purchaseDate} onChangeText={setPurchaseDate} style={s.input}/>
      <Text style={s.fieldLabel}>Quantity ({displayPurchaseUnit(purchaseUnit)})</Text><TextInput value={purchaseQuantity} onChangeText={setPurchaseQuantity} keyboardType="decimal-pad" placeholder={purchaseUnit === 'kg' ? 'e.g. 1.5' : 'e.g. 20'} style={s.input}/>
      <Text style={s.fieldLabel}>Total price paid (₹)</Text><TextInput value={purchaseCost} onChangeText={setPurchaseCost} keyboardType="decimal-pad" placeholder="e.g. 250" style={s.input}/>
      <TouchableOpacity style={[s.primary, s.printerAction]} onPress={savePurchase}><Text style={s.primaryText}>Save stock purchase</Text></TouchableOpacity>
      <Text style={[s.sectionTitle, { marginTop: 22 }]}>Recent purchases</Text>{purchaseHistory.map(row => <View key={row.id} style={s.purchaseRow}><View style={{ flex: 1 }}><Text style={s.itemName}>{row.item_name} · {row.purchase_date}</Text><Text style={s.itemPrice}>{row.quantity} {displayPurchaseUnit(row.unit)}</Text></View><Text style={s.orderTotal}>{money(row.total_cost)}</Text></View>)}{!purchaseHistory.length && <Text style={s.hint}>Purchases you add will appear here.</Text>}
    </ScrollView></KeyboardAvoidingView>}
    {tab === 'analysis' && <View style={s.body}>
      <Text style={s.sectionTitle}>Sales and inventory costs</Text>
      <Text style={s.fieldLabel}>Period start and end (YYYY-MM-DD)</Text>
      <View style={s.dateRow}><TextInput value={rangeStart} onChangeText={setRangeStart} style={s.dateInput} autoCapitalize="none"/><TextInput value={rangeEnd} onChangeText={setRangeEnd} style={s.dateInput} autoCapitalize="none"/><TouchableOpacity style={s.smallPrimary} onPress={() => refreshRangeReport(rangeStart, rangeEnd)}><Text style={s.primaryText}>View</Text></TouchableOpacity></View>
      <View style={s.summary}><Text style={s.summaryLabel}>Total sales</Text><Text style={s.summaryValue}>{money(rangeSales)}</Text></View>
      <View style={s.summary}><Text style={s.summaryLabel}>Inventory cost</Text><Text style={s.summaryValue}>{money(rangeCost)}</Text></View>
      <View style={s.summary}><Text style={s.summaryLabel}>Sales less purchases</Text><Text style={s.summaryValue}>{money(rangeSales - rangeCost)}</Text></View>
      <Text style={s.hint}>Across selected dates · {rangeOrders} orders. Purchases are counted on the date you record them.</Text>
      <Text style={s.sectionTitle}>Purchases in this period</Text><ScrollView style={{ flex: 1 }}>{purchaseHistory.filter(item => item.purchase_date >= rangeStart && item.purchase_date <= rangeEnd).map(row => <View key={row.id} style={s.purchaseRow}><View style={{ flex: 1 }}><Text style={s.itemName}>{row.item_name}</Text><Text style={s.itemPrice}>{row.purchase_date} · {row.quantity} {displayPurchaseUnit(row.unit)}</Text></View><Text style={s.orderTotal}>{money(row.total_cost)}</Text></View>)}</ScrollView>
    </View>}
    {tab === 'report' && <View style={s.body}>
      <Text style={s.sectionTitle}>Sales by item</Text>
      <Text style={s.fieldLabel}>Report date (YYYY-MM-DD)</Text>
      <View style={s.dateRow}>
        <TextInput value={reportDate} onChangeText={setReportDate} style={s.dateInput} autoCapitalize="none"/>
        <TouchableOpacity style={s.smallPrimary} onPress={() => refreshReport(reportDate)}><Text style={s.primaryText}>View</Text></TouchableOpacity>
      </View>
      <View style={s.summary}><Text style={s.summaryLabel}>Orders</Text><Text style={s.summaryValue}>{orderCount}</Text></View>
      <View style={s.summary}><Text style={s.summaryLabel}>Total sales</Text><Text style={s.summaryValue}>{money(reportTotal)}</Text></View>
      <View style={s.summary}><Text style={s.summaryLabel}>Average order amount</Text><Text style={s.summaryValue}>{money(averageOrderAmount)}</Text></View>
      <TouchableOpacity style={[s.secondary, s.printerAction]} onPress={() => setReportPreviewVisible(true)}>
        <Text style={s.secondaryText}>Preview report</Text>
      </TouchableOpacity>
      <ScrollView style={{ flex: 1 }}>
        <View style={[s.itemRow, s.reportHead]}><Text style={[s.reportCell, { flex: 1 }]}>ITEM</Text><Text style={s.reportCell}>QTY</Text><Text style={[s.reportCell, { width: 105, textAlign: 'right' }]}>SALES</Text></View>
        {rows.map(r => <View key={r.name} style={s.reportLine}><Text style={[s.reportName, { flex: 1 }]}>{r.name}</Text><Text style={s.reportQty}>{r.quantity}</Text><Text style={s.reportAmount}>{money(r.revenue)}</Text></View>)}
        {!rows.length && <Text style={s.hint}>No orders recorded for this date.</Text>}
      </ScrollView>
      <Text style={s.faintFooter}>!! દેવેન ના જય સચ્ચિદાનંદ !!</Text>
    </View>}
    {tab === 'printer' && <View style={s.body}><Text style={s.sectionTitle}>Printer connection</Text><Text style={s.fieldLabel}>Starting receipt serial number</Text><TextInput value={receiptSerialStart} onChangeText={setReceiptSerialStart} placeholder="1" keyboardType="number-pad" style={s.input}/><Text style={s.hint}>Use a different starting number on each device, for example 1 on one and 500 on another. This applies to new daily receipt sequences; existing numbers stay unchanged.</Text><TouchableOpacity style={s.secondary} onPress={saveReceiptSerialStart}><Text style={s.secondaryText}>Save starting serial number</Text></TouchableOpacity><View style={s.copyTabs}><TouchableOpacity style={[s.copyTab, printerMode === 'wifi' && s.copyTabActive]} onPress={() => savePrinterMode('wifi')}><Text style={[s.copyTabText, printerMode === 'wifi' && s.copyTabTextActive]}>Wi-Fi</Text></TouchableOpacity><TouchableOpacity style={[s.copyTab, printerMode === 'bluetooth' && s.copyTabActive]} onPress={() => savePrinterMode('bluetooth')}><Text style={[s.copyTabText, printerMode === 'bluetooth' && s.copyTabTextActive]}>Bluetooth</Text></TouchableOpacity></View>{printerMode === 'wifi' ? <><Text style={s.hint}>Connect the tablet and printer to the same Wi-Fi network. Enter the printer IP from its network test page. The common ESC/POS port is 9100; change it if your printer setup specifies another port.</Text><Text style={s.fieldLabel}>Printer IP address</Text><TextInput value={printerHost} onChangeText={setPrinterHost} placeholder="e.g. 192.168.1.50" keyboardType="numbers-and-punctuation" autoCapitalize="none" style={s.input}/><Text style={s.fieldLabel}>Printer port</Text><TextInput value={printerPort} onChangeText={setPrinterPort} placeholder="9100" keyboardType="number-pad" style={s.input}/><TouchableOpacity style={[s.primary, s.printerAction]} onPress={savePrinterSettings}><Text style={s.primaryText}>Save Wi-Fi settings</Text></TouchableOpacity></> : <><Text style={s.hint}>Bluetooth Classic works on Android. Turn on the printer, pair it from Android Settings if prompted, then search here and select KP307-UEWB.</Text><TouchableOpacity style={[s.secondary, scanningBluetooth && s.disabled]} disabled={scanningBluetooth} onPress={scanBluetoothPrinters}><Text style={s.secondaryText}>{scanningBluetooth ? 'Searching…' : 'Search for Bluetooth printers'}</Text></TouchableOpacity>{bluetoothDeviceId ? <Text style={s.printerStatus}>Selected: {bluetoothDeviceName} ({bluetoothDeviceId})</Text> : null}{bluetoothDevices.map(device => <TouchableOpacity key={device.id} style={[s.deviceRow, bluetoothDeviceId === device.id && s.deviceRowSelected]} onPress={() => selectBluetoothPrinter(device)}><View style={{ flex: 1 }}><Text style={s.deviceName}>{device.name || 'Bluetooth device'}</Text><Text style={s.hint}>{device.id}{device.bondState ? ` · ${device.bondState}` : ''}</Text></View><Text style={s.actionText}>{bluetoothDeviceId === device.id ? 'Selected' : 'Select'}</Text></TouchableOpacity>)}</> }<TouchableOpacity style={[s.secondary, printing && s.disabled]} disabled={printing} onPress={runPrinterTest}><Text style={s.secondaryText}>{printing ? 'Connecting…' : 'Print test slip'}</Text></TouchableOpacity>{printerStatus ? <Text style={s.printerStatus}>{printerStatus}</Text> : null}<Text style={s.hint}>After setup, open an order receipt and tap “Print customer + staff slips”.</Text></View>}
    <Modal visible={modal} transparent animationType="fade" onRequestClose={() => setModal(false)}><View style={s.scrim}><View style={s.dialog}><Text style={s.title}>{editItem ? 'Edit item' : 'Add item'}</Text><Text style={s.fieldLabel}>Item name</Text><TextInput value={name} onChangeText={setName} placeholder="e.g. Sandwich" style={s.input}/><Text style={s.fieldLabel}>Price (₹)</Text><TextInput value={price} onChangeText={setPrice} placeholder="0" keyboardType="decimal-pad" style={s.input}/><View style={s.dialogButtons}><TouchableOpacity onPress={() => setModal(false)} style={s.cancel}><Text>Cancel</Text></TouchableOpacity><TouchableOpacity onPress={saveMenuItem} style={s.smallPrimary}><Text style={s.primaryText}>Save item</Text></TouchableOpacity></View></View></View></Modal>
    <Modal visible={addingToOrder !== null} transparent animationType="fade" onRequestClose={() => setAddingToOrder(null)}><View style={s.scrim}><View style={s.dialog}><Text style={s.title}>Add item to order</Text><Text style={s.hint}>Choose a menu item. It will be added at its current menu price.</Text><ScrollView style={{ maxHeight: 320 }}>{menu.map(item => <TouchableOpacity key={item.id} style={s.addMenuRow} onPress={() => addingToOrder !== null && addMenuItemToOrder(addingToOrder, item)}><Text style={s.itemName}>{item.name}</Text><Text style={s.itemPrice}>{money(item.price)}</Text></TouchableOpacity>)}</ScrollView><View style={s.dialogButtons}><TouchableOpacity onPress={() => setAddingToOrder(null)} style={s.cancel}><Text>Close</Text></TouchableOpacity></View></View></View></Modal>
    <Modal visible={reportPreviewVisible} transparent animationType="slide" onRequestClose={() => setReportPreviewVisible(false)}><View style={s.scrim}><View style={s.receiptDialog}><View style={s.receiptHeader}><Text style={s.receiptTitle}>Report preview</Text><TouchableOpacity onPress={() => setReportPreviewVisible(false)}><Text style={s.actionText}>Close</Text></TouchableOpacity></View><ScrollView style={s.receiptPaper}><Text style={s.receiptBrand}>TRIMANDIR CANTEEN</Text><Text style={s.receiptKind}>DAILY REPORT</Text><Text style={s.receiptDate}>{loadedReportDate}</Text><View style={s.receiptDivider}/><View style={s.receiptLine}><Text style={s.receiptItem}>Orders</Text><Text style={s.receiptAmount}>{orderCount}</Text></View><View style={s.receiptLine}><Text style={s.receiptItem}>Total sales</Text><Text style={s.receiptAmount}>{money(reportTotal)}</Text></View><View style={s.receiptLine}><Text style={s.receiptItem}>Average order amount</Text><Text style={s.receiptAmount}>{money(averageOrderAmount)}</Text></View><View style={s.receiptDivider}/><View style={[s.itemRow, s.reportHead]}><Text style={[s.reportCell, { flex: 1 }]}>ITEM</Text><Text style={s.reportCell}>QTY</Text><Text style={[s.reportCell, { width: 95, textAlign: 'right' }]}>SALES</Text></View>{rows.map(row => <View key={row.name} style={s.reportLine}><Text style={[s.reportName, { flex: 1 }]}>{row.name}</Text><Text style={s.reportQty}>{row.quantity}</Text><Text style={[s.reportAmount, { width: 95 }]}>{money(row.revenue)}</Text></View>)}{!rows.length && <Text style={s.hint}>No orders recorded for this date.</Text>}<Text style={s.faintFooter}>!! દેવેન ના જય સચ્ચિદાનંદ !!</Text></ScrollView><TouchableOpacity style={[s.primary, s.printerAction, printing && s.disabled]} disabled={printing} onPress={printReport}><Text style={s.primaryText}>{printing ? 'Printing report…' : 'Print report'}</Text></TouchableOpacity></View></View></Modal>
    <Modal visible={receipt !== null} transparent animationType="slide" onRequestClose={() => setReceipt(null)}><View style={s.scrim}><View style={s.receiptDialog}><View style={s.receiptHeader}><Text style={s.receiptTitle}>Receipt preview</Text><TouchableOpacity onPress={() => setReceipt(null)}><Text style={s.actionText}>Close</Text></TouchableOpacity></View><View style={s.copyTabs}><TouchableOpacity style={[s.copyTab, receiptCopy === 'customer' && s.copyTabActive]} onPress={() => setReceiptCopy('customer')}><Text style={[s.copyTabText, receiptCopy === 'customer' && s.copyTabTextActive]}>Customer</Text></TouchableOpacity><TouchableOpacity style={[s.copyTab, receiptCopy === 'staff' && s.copyTabActive]} onPress={() => setReceiptCopy('staff')}><Text style={[s.copyTabText, receiptCopy === 'staff' && s.copyTabTextActive]}>Staff slips</Text></TouchableOpacity></View>{receipt && (receiptCopy === 'customer' ? <ScrollView style={s.receiptPaper}><Text style={s.receiptKind}>CUSTOMER COPY</Text><Text style={s.receiptDate}>{new Date(receipt.created_at).toLocaleString()}</Text><View style={s.customerTokenBox}><Text style={s.customerTokenLabel}>YOUR TOKEN</Text><Text style={s.customerToken}>#{receipt.token}</Text></View><Text style={s.receiptItemCount}>TOTAL ITEMS: {receipt.items.reduce((sum, item) => sum + item.quantity, 0)}</Text><View style={s.receiptDivider}/>{receipt.items.map(item => <View key={item.id} style={s.receiptLine}><Text style={s.receiptItem}>{item.quantity} × {item.item_name}</Text><Text style={s.receiptAmount}>{money(item.unit_price * item.quantity)}</Text></View>)}<View style={s.receiptDivider}/><View style={s.receiptTotal}><Text style={s.receiptTotalLabel}>TOTAL</Text><Text style={s.receiptTotalValue}>{money(receipt.total)}</Text></View></ScrollView> : <ScrollView style={s.staffSlips}>{receipt.items.map(item => <View key={item.id} style={s.staffSlip}><Text style={s.receiptKind}>STAFF COPY</Text><Text style={s.staffToken}>TOKEN #{receipt.token}</Text><Text style={s.receiptDate}>{new Date(receipt.created_at).toLocaleString()}</Text><View style={s.receiptDivider}/><Text style={s.staffItem}>{item.quantity} × {item.item_name}</Text></View>)}</ScrollView>)}{receipt && <TouchableOpacity style={[s.primary, s.printerAction, printing && s.disabled]} disabled={printing} onPress={printReceiptSet}><Text style={s.primaryText}>{printing ? 'Sending to printer…' : 'Print customer + staff slips'}</Text></TouchableOpacity>}</View></View></Modal>
  </SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider><CanteenApp /></SafeAreaProvider>;
}

const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#f4f5f2' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f5f2' }, header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, eyebrow: { color: '#68766a', fontSize: 11, fontWeight: '800', letterSpacing: 1.3, marginBottom: 5 }, title: { fontSize: 25, color: '#18291e', fontWeight: '800' }, localBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e5efe5', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#3c8953', marginRight: 6 }, localText: { color: '#397248', fontWeight: '800', fontSize: 10, letterSpacing: .5 }, tabScroll: { flexGrow: 0, flexShrink: 0 }, tabs: { flexDirection: 'row', paddingHorizontal: 16, gap: 6, borderBottomWidth: 1, borderBottomColor: '#e3e7e1' }, tab: { paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 3, borderBottomColor: 'transparent' }, tabActive: { borderBottomColor: '#31774a' }, tabText: { color: '#7a827b', fontWeight: '700' }, tabTextActive: { color: '#25643b' }, body: { flex: 1, paddingHorizontal: 22, paddingTop: 20 }, sectionTitle: { color: '#36443a', fontSize: 16, fontWeight: '700', marginBottom: 13 }, nextTokenHint: { color: '#28643b', fontSize: 13, fontWeight: '700', marginBottom: 10 }, list: { paddingBottom: 16 }, itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 14, backgroundColor: '#fff', borderRadius: 13, marginBottom: 9, borderWidth: 1, borderColor: '#edf0eb' }, menuImage: { width: 58, height: 58, borderRadius: 10, marginRight: 12, backgroundColor: '#edf1ec' }, itemName: { color: '#1e2b22', fontSize: 16, fontWeight: '700' }, itemPrice: { color: '#718075', fontSize: 13, marginTop: 3 }, qtyButton: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#edf1ec', alignItems: 'center', justifyContent: 'center' }, qtyAdd: { backgroundColor: '#287243' }, qtyLabel: { color: '#36483a', fontSize: 22, fontWeight: '600', marginTop: -2 }, qty: { minWidth: 38, textAlign: 'center', color: '#27352a', fontWeight: '700', fontSize: 16 }, cart: { backgroundColor: '#fff', padding: 16, borderRadius: 16, marginBottom: 10, borderColor: '#e8ece6', borderWidth: 1 }, totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }, totalLabel: { fontSize: 15, color: '#516056', fontWeight: '600' }, total: { fontSize: 23, fontWeight: '800', color: '#1e3022' }, primary: { backgroundColor: '#287243', paddingVertical: 14, alignItems: 'center', borderRadius: 11 }, primaryText: { color: '#fff', fontSize: 14, fontWeight: '800' }, disabled: { opacity: .45 }, secondary: { backgroundColor: '#e8eee7', paddingVertical: 13, alignItems: 'center', borderRadius: 11, marginTop: 10 }, secondaryText: { color: '#28643b', fontSize: 14, fontWeight: '800' }, printerAction: { marginTop: 14 }, faintFooter: { color: '#e0e4e0', fontSize: 9, textAlign: 'center', paddingTop: 5, paddingBottom: 2 }, deviceRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e9e3', borderRadius: 10, padding: 12, marginTop: 8 }, deviceRowSelected: { borderColor: '#2b7547', backgroundColor: '#f0f6f0' }, deviceName: { color: '#24372a', fontSize: 14, fontWeight: '700' }, printerStatus: { color: '#28643b', fontSize: 13, fontWeight: '700', paddingVertical: 10 }, hint: { color: '#8a938c', fontSize: 12, paddingVertical: 10 }, toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, smallPrimary: { backgroundColor: '#287243', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 }, action: { padding: 9, marginLeft: 5 }, actionText: { color: '#32774a', fontWeight: '700' }, fieldLabel: { color: '#58665c', fontWeight: '700', fontSize: 13, marginTop: 14, marginBottom: 6 }, dateRow: { flexDirection: 'row', gap: 8, marginBottom: 14 }, dateInput: { flex: 1, minWidth: 0, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dfe5dd', color: '#243328' }, summary: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#e6efe6', borderRadius: 12, padding: 14, marginBottom: 8 }, summaryLabel: { color: '#536a58', fontWeight: '600' }, summaryValue: { color: '#225b34', fontSize: 16, fontWeight: '800' }, suggestions: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dfe5dd', borderRadius: 10, marginTop: 5, paddingHorizontal: 12 }, suggestionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#edf0eb' }, newItemHint: { color: '#397248', fontSize: 12, paddingVertical: 10 }, purchaseRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: '#edf0eb' }, reportHead: { backgroundColor: 'transparent', borderWidth: 0, borderBottomWidth: 1, borderColor: '#dbe2d9', borderRadius: 0, marginBottom: 0, paddingHorizontal: 6 }, reportCell: { color: '#7b867d', fontSize: 10, fontWeight: '800', width: 42 }, reportLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6, borderBottomWidth: 1, borderColor: '#e5e9e3' }, reportName: { color: '#29382d', fontSize: 14, fontWeight: '600' }, reportQty: { width: 42, textAlign: 'center', color: '#536056' }, reportAmount: { width: 105, textAlign: 'right', color: '#29382d', fontWeight: '700' }, orderCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 13, marginBottom: 8, borderWidth: 1, borderColor: '#edf0eb' }, orderToken: { color: '#24372a', fontSize: 15, fontWeight: '800' }, deleteButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: '#fbecea' }, deleteText: { color: '#a94737', fontWeight: '700' }, historyCard: { backgroundColor: '#fff', borderRadius: 15, padding: 14, marginBottom: 12, borderColor: '#e8ece6', borderWidth: 1 }, orderTotal: { color: '#1e3022', fontSize: 18, fontWeight: '800' }, historyLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderColor: '#eef0ec' }, addToOrder: { alignItems: 'center', paddingVertical: 10, marginTop: 5, backgroundColor: '#edf4ed', borderRadius: 9 }, cancelOrderButton: { alignItems: 'center', paddingVertical: 10, marginTop: 8, backgroundColor: '#fbecea', borderRadius: 9 }, emptyHistory: { color: '#778279', textAlign: 'center', paddingVertical: 30 }, addMenuRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderColor: '#edf0eb' }, receiptItemCount: { color: '#555', textAlign: 'center', fontSize: 11, fontWeight: '800', marginTop: 8 }, customerTokenBox: { alignItems: 'center', backgroundColor: '#f1f5ef', borderWidth: 2, borderColor: '#24372a', borderRadius: 10, paddingVertical: 12, marginTop: 12 }, customerTokenLabel: { color: '#24372a', fontSize: 11, fontWeight: '900', letterSpacing: 1.5 }, customerToken: { color: '#111', textAlign: 'center', fontSize: 52, lineHeight: 60, fontWeight: '900' }, staffSlips: { maxHeight: 460, marginBottom: 13 }, staffSlip: { backgroundColor: '#fff', borderRadius: 8, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: '#e5e5e2' }, staffToken: { color: '#111', textAlign: 'center', fontSize: 32, fontWeight: '900', marginTop: 14 }, staffItem: { color: '#111', textAlign: 'center', fontSize: 24, fontWeight: '900', paddingVertical: 12 }, receiptLink: { alignItems: 'center', paddingVertical: 9, marginTop: 7 }, receiptDialog: { backgroundColor: '#f1f2ef', borderRadius: 18, padding: 16, maxHeight: '92%' }, receiptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }, receiptTitle: { color: '#18291e', fontSize: 20, fontWeight: '800' }, copyTabs: { flexDirection: 'row', backgroundColor: '#e3e8e1', borderRadius: 10, padding: 3, marginBottom: 12 }, copyTab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 8 }, copyTabActive: { backgroundColor: '#fff' }, copyTabText: { color: '#718075', fontWeight: '700' }, copyTabTextActive: { color: '#25643b' }, receiptPaper: { backgroundColor: '#fff', borderRadius: 8, padding: 20, marginBottom: 13, maxHeight: 420, borderWidth: 1, borderColor: '#e5e5e2' }, receiptBrand: { color: '#111', textAlign: 'center', fontSize: 19, fontWeight: '900', letterSpacing: .4, marginTop: 4 }, receiptKind: { color: '#555', textAlign: 'center', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 6 }, receiptDate: { color: '#666', textAlign: 'center', fontSize: 11, marginTop: 4 }, receiptDivider: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#888', marginVertical: 12 }, receiptLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 6 }, receiptItem: { color: '#222', fontSize: 14, flex: 1, fontWeight: '600' }, receiptAmount: { color: '#222', fontSize: 14, marginLeft: 8 }, receiptTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, receiptTotalLabel: { color: '#111', fontSize: 16, fontWeight: '800' }, receiptTotalValue: { color: '#111', fontSize: 19, fontWeight: '900' }, receiptFooter: { color: '#222', textAlign: 'center', fontSize: 13, fontWeight: '700', paddingVertical: 5 }, scrim: { flex: 1, backgroundColor: '#0007', justifyContent: 'center', padding: 22 }, dialog: { backgroundColor: '#fff', borderRadius: 18, padding: 22 }, input: { backgroundColor: '#f7f8f6', borderWidth: 1, borderColor: '#dfe5dd', padding: 12, borderRadius: 10, color: '#1c2b20' }, dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 20 }, cancel: { padding: 12 } });
