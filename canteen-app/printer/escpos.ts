import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import type Socket from 'react-native-tcp-socket/lib/types/Socket';
import { GUJARATI_REPORT_FOOTER } from './gujaratiFooter';

export type PrintableOrder = {
  token: number;
  total: number;
  created_at: string;
  items: Array<{
    item_name: string;
    unit_price: number;
    quantity: number;
  }>;
};

export type PrintableReport = {
  date: string;
  orders: number;
  totalSales: number;
  averageOrderAmount: number;
  items: Array<{ name: string; quantity: number; revenue: number }>;
};

const ESC = 0x1b;
const GS = 0x1d;
const WIDTH = 48;

function command(...bytes: number[]) {
  return Buffer.from(bytes);
}

function ascii(value: string) {
  // Most ESC/POS printers use a legacy single-byte code page. Keep unsupported
  // characters printable instead of sending malformed UTF-8 byte sequences.
  return Buffer.from(value.normalize('NFD').replace(/[^\x20-\x7e]/g, '?'), 'ascii');
}

function line(value = '') {
  return Buffer.concat([ascii(value), command(0x0a)]);
}

function centered(value: string) {
  return Buffer.concat([command(ESC, 0x61, 0x01), line(value), command(ESC, 0x61, 0x00)]);
}

function separator() {
  return line('-'.repeat(WIDTH));
}

function cut() {
  return Buffer.concat([command(0x0a, 0x0a, 0x0a), command(GS, 0x56, 0x00)]);
}

function startSlip() {
  return command(ESC, 0x40, ESC, 0x74, 0x00);
}

function amount(value: number) {
  return `Rs. ${value.toFixed(2)}`;
}

function itemRow(quantity: number, name: string, subtotal?: number) {
  const left = `${quantity} x ${name}`;
  if (subtotal === undefined) return line(left);
  const right = amount(subtotal);
  const available = Math.max(1, WIDTH - right.length - 1);
  const fittedLeft = left.length > available ? `${left.slice(0, available - 1)}…` : left;
  return line(`${fittedLeft}${' '.repeat(Math.max(1, WIDTH - fittedLeft.length - right.length))}${right}`);
}

function amountRow(label: string, value: number) {
  const right = amount(value);
  const left = label.slice(0, Math.max(1, WIDTH - right.length - 1));
  return line(`${left}${' '.repeat(Math.max(1, WIDTH - left.length - right.length))}${right}`);
}

function gujaratiReportFooter() {
  // ESC/POS raster bit image (GS v 0), centered and rendered as a light halftone.
  const widthBytes = 55;
  const height = 54;
  return Buffer.concat([
    command(ESC, 0x61, 0x01),
    command(GS, 0x76, 0x30, 0x00, widthBytes & 0xff, widthBytes >> 8, height & 0xff, height >> 8),
    GUJARATI_REPORT_FOOTER,
    command(0x0a, ESC, 0x61, 0x00),
  ]);
}

function customerSlip(order: PrintableOrder) {
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return Buffer.concat([
    startSlip(),
    centered('CUSTOMER COPY'),
    centered(new Date(order.created_at).toLocaleString()),
    command(ESC, 0x45, 0x01),
    command(ESC, 0x61, 0x01), command(GS, 0x21, 0x11), line(`TOKEN #${order.token}`),
    command(GS, 0x21, 0x00), command(ESC, 0x45, 0x00), command(ESC, 0x61, 0x00),
    separator(),
    line(`TOTAL ITEMS: ${itemCount}`),
    ...order.items.map(item => itemRow(item.quantity, item.item_name, item.unit_price * item.quantity)),
    separator(),
    command(ESC, 0x45, 0x01), amountRow('TOTAL', order.total), command(ESC, 0x45, 0x00),
    cut(),
  ]);
}

function staffSlip(order: PrintableOrder, item: PrintableOrder['items'][number]) {
  return Buffer.concat([
    startSlip(),
    centered('STAFF COPY'),
    command(ESC, 0x61, 0x01), command(ESC, 0x45, 0x01), command(GS, 0x21, 0x11),
    line(`TOKEN #${order.token}`),
    command(GS, 0x21, 0x00), command(ESC, 0x45, 0x00),
    centered(new Date(order.created_at).toLocaleString()),
    separator(),
    command(ESC, 0x45, 0x01), command(GS, 0x21, 0x01),
    centered(`${item.quantity} x ${item.item_name}`),
    command(GS, 0x21, 0x00), command(ESC, 0x45, 0x00),
    command(ESC, 0x61, 0x00),
    cut(),
  ]);
}

export function makeOrderPrintJob(order: PrintableOrder) {
  return Buffer.concat([customerSlip(order), ...order.items.map(item => staffSlip(order, item))]);
}

export function makePrinterTestJob() {
  return Buffer.concat([
    startSlip(),
    command(ESC, 0x45, 0x01), centered('TRIMANDIR CANTEEN'), command(ESC, 0x45, 0x00),
    centered('PRINTER TEST'),
    separator(),
    line('Wi-Fi ESC/POS connection is working.'),
    separator(),
    cut(),
  ]);
}

export function makeReportPrintJob(report: PrintableReport) {
  const itemLines = report.items.map(item => {
    const name = item.name.length > 22 ? `${item.name.slice(0, 21)}?` : item.name;
    const qty = String(item.quantity).padStart(5);
    const sales = amount(item.revenue).padStart(18);
    return line(`${name.padEnd(23)}${qty}${sales}`);
  });
  return Buffer.concat([
    startSlip(),
    command(ESC, 0x45, 0x01), centered('TRIMANDIR CANTEEN'), command(ESC, 0x45, 0x00),
    centered('DAILY REPORT'),
    line(`DATE: ${report.date}`),
    separator(),
    line(`${'ITEM'.padEnd(23)}${'QTY'.padStart(5)}${'SALES'.padStart(18)}`),
    ...itemLines,
    separator(),
    line(`ORDERS: ${report.orders}`),
    amountRow('TOTAL SALES', report.totalSales),
    amountRow('AVERAGE ORDER', report.averageOrderAmount),
    gujaratiReportFooter(),
    cut(),
  ]);
}

export async function sendPrintJob(host: string, port: number, data: Uint8Array) {
  if (!host.trim()) throw new Error('Enter the printer IP address first.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a valid printer port.');
  if (Platform.OS === 'web') throw new Error('Wi-Fi printer printing is available in the Android app build.');

  // Require lazily so starting the app in Expo Go still works for order entry
  // and receipt previews; the native TCP module is used only by a custom APK.
  const tcpModule = require('react-native-tcp-socket');
  // react-native-tcp-socket exposes its API through module.exports in the
  // Metro bundle, so `.default` is not present in every build configuration.
  const TcpSocket = tcpModule?.default ?? tcpModule;
  if (typeof TcpSocket?.createConnection !== 'function') {
    throw new Error('The Wi-Fi printer module is unavailable. Install a development APK that includes react-native-tcp-socket.');
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let socket: Socket;
    socket = TcpSocket.createConnection({ host: host.trim(), port, connectTimeout: 8000 }, () => {
      socket.setTimeout(10000);
      socket.write(Buffer.from(data), 'binary', (error?: Error) => {
        if (error) {
          socket.destroy();
          reject(error);
          return;
        }
        socket.end();
      });
    });
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('Printer connection timed out. Check the IP, port, and Wi-Fi network.')));
    socket.on('close', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
  });
}

export async function sendBluetoothPrintJob(deviceId: string, data: Uint8Array) {
  // Load the native module only when Bluetooth printing is used so Wi-Fi stays
  // available in runtimes that do not include this native module (for example Expo Go).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bluetooth = require('react-native-bluetooth-ble') as {
    connectClassic: (id: string) => Promise<void>;
    writeClassic: (id: string, hex: string) => Promise<void>;
    disconnectClassic: (id: string) => void;
  };
  const hex = Buffer.from(data).toString('hex');
  await bluetooth.connectClassic(deviceId);
  try {
    // Keep chunks small for printer firmware with a limited RFCOMM receive buffer.
    const chunkSize = 1024;
    for (let offset = 0; offset < hex.length; offset += chunkSize * 2) {
      await bluetooth.writeClassic(deviceId, hex.slice(offset, offset + chunkSize * 2));
    }
  } finally {
    bluetooth.disconnectClassic(deviceId);
  }
}
