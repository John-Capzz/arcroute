# ⟡ ArcRoute — Multi-Chain USDC Router

Route any EVM token (USDT/USDC) from Ethereum, BNB Chain, or Base into **USDC on Arc Testnet**, powered by [Circle App Kit](https://developers.circle.com/w3s/circle-app-kit).

---

## Architecture

```
User → Frontend (Next.js)
         ↓ POST /convert
       Backend (Express)
         ↓
       Router Engine
         ├─ kit.swap()   → USDT → USDC (source chain)
         ├─ kit.bridge() → USDC → Arc Testnet
         └─ kit.send()   → USDC → destination wallet
         ↓
       SQLite DB (transaction tracking)
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+
- Circle App Kit API credentials → [Get them here](https://console.circle.com)

---

### 1. Clone & configure

```bash
git clone <repo>
cd arcroute
```

---

### 2. Backend setup

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# ↑ Fill in CIRCLE_APP_KIT_API_KEY and CIRCLE_APP_KIT_CLIENT_ID

# Start dev server
npm run dev
```

The API will start on **http://localhost:3001**

---

### 3. Frontend setup

```bash
cd frontend

# Install dependencies
npm install

# (Optional) configure API URL
echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > .env.local

# Start dev server
npm run dev
```

The UI will start on **http://localhost:3000**

---

## API Reference

### `POST /convert`

Start a routing transaction.

**Request:**
```json
{
  "chain": "Ethereum_Sepolia",
  "token": "USDT",
  "amount": "10",
  "destination": "0xAbCd1234..."
}
```

**Supported chains:** `Ethereum_Sepolia`, `BNB_Testnet`, `Base_Sepolia`
**Supported tokens:** `USDT`, `USDC`

**Response (202):**
```json
{
  "success": true,
  "transactionId": "550e8400-e29b-41d4-a716-446655440000",
  "estimatedOutput": "9.970000",
  "feeAmount": "0.030000",
  "feePercent": 0.3,
  "outputToken": "USDC",
  "outputChain": "Arc_Testnet",
  "statusUrl": "/status/550e8400-e29b-41d4-a716-446655440000"
}
```

---

### `GET /status/:id`

Poll transaction status.

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "bridging",
  "steps": {
    "swap": "done",
    "bridge": "pending",
    "send": "pending"
  },
  "txHash": "0xabc123...",
  "chain": "Ethereum_Sepolia",
  "token": "USDT",
  "amount": "10",
  "destination": "0xAbCd...",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:05.123Z"
}
```

**Status values:** `pending` → `swapping` → `bridging` → `sending` → `completed` | `failed`

**Step values:** `pending` | `done` | `skipped` | `failed`

---

### `GET /estimate?amount=10`

Get fee estimate without creating a transaction.

**Response:**
```json
{
  "input": "10.000000",
  "fee": "0.030000",
  "feePercent": 0.3,
  "estimatedOutput": "9.970000",
  "outputToken": "USDC",
  "outputChain": "Arc_Testnet"
}
```

---

### `GET /health`

```json
{ "status": "ok", "version": "1.0.0", "service": "ArcRoute API" }
```

---

## Example cURL Requests

```bash
# 1. Get a fee estimate
curl "http://localhost:3001/estimate?amount=100"

# 2. Start a USDT → USDC conversion from Ethereum Sepolia
curl -X POST http://localhost:3001/convert \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "Ethereum_Sepolia",
    "token": "USDT",
    "amount": "50",
    "destination": "0x1234567890abcdef1234567890abcdef12345678"
  }'

# 3. Poll status (replace with actual ID from step 2)
curl "http://localhost:3001/status/550e8400-e29b-41d4-a716-446655440000"

# 4. USDC passthrough (already USDC, skip swap)
curl -X POST http://localhost:3001/convert \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "Base_Sepolia",
    "token": "USDC",
    "amount": "25",
    "destination": "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  }'
```

---

## App Kit Integration

The routing engine (`backend/src/services/router.ts`) uses three Circle App Kit methods:

| Method | When called | Purpose |
|--------|-------------|---------|
| `kit.swap()` | token ≠ USDC | Convert USDT → USDC on source chain |
| `kit.bridge()` | chain ≠ Arc_Testnet | Move USDC across chains to Arc Testnet |
| `kit.send()` | Always | Deliver USDC to destination wallet |

The App Kit configuration (`backend/src/lib/appkit.ts`) creates viem EVM adapters for:
- **Ethereum Sepolia** → `sepolia` (viem)
- **BNB Testnet** → `bscTestnet` (viem)
- **Base Sepolia** → `baseSepolia` (viem)
- **Arc Testnet** → custom chain definition

Without a real API key, the backend runs in **simulation mode** – it logs all operations and returns mock tx hashes, allowing full UI testing without credentials.

---

## Fee Structure

- Protocol fee: **0.3%** (configurable via `FEE_PERCENT` env var)
- Deducted from input before swap/bridge/send
- Displayed in UI before confirmation

---

## Security Model

- **Non-custodial**: Private keys never leave the user's device
- **User signs**: All transactions require wallet signature
- **No key storage**: Backend only orchestrates, never holds keys
- **Testnets only**: Configured for testnet chains by default

---

## Project Structure

```
arcroute/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Express server + routes
│   │   ├── lib/
│   │   │   └── appkit.ts     # Circle App Kit + viem adapters
│   │   ├── services/
│   │   │   └── router.ts     # Swap/bridge/send orchestration
│   │   └── db/
│   │       └── database.ts   # SQLite schema + repository
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
└── frontend/
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx
    │   │   ├── globals.css
    │   │   ├── convert/
    │   │   │   └── page.tsx  # Main conversion UI
    │   │   └── status/
    │   │       └── [id]/
    │   │           └── page.tsx  # Live status polling
    │   └── lib/
    │       └── api.ts        # API client
    ├── package.json
    ├── next.config.js
    ├── tailwind.config.js
    └── tsconfig.json
```
