// exchange.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Order {
  creator: string;
  orderType: number;
  amount: number;
  price: number;
  filled: number;
  expiry: number;
  active: boolean;
}

interface ContractState {
  paused: boolean;
  admin: string;
  orderCounter: number;
  orders: Map<number, Order>;
  userOrderCount: Map<string, number>;
  userOrders: Map<string, Map<number, number>>; // user -> index -> orderId
}

// Mock external calls (simplified)
const mockExternal = {
  isRegistered: (user: string) => true,
  checkCompliance: (buyer: string, seller: string, amount: number, price: number) => true,
  getOracleValidation: (user: string) => true,
  lockStx: () => ({ ok: true, value: true }),
  lockTokens: () => ({ ok: true, value: true }),
  release: () => ({ ok: true, value: true }),
  settle: () => ({ ok: true, value: true }),
  ftTransfer: () => ({ ok: true, value: true }),
  stxTransfer: () => ({ ok: true, value: true }),
};

// Mock contract implementation
class ExchangeMock {
  private state: ContractState = {
    paused: false,
    admin: "deployer",
    orderCounter: 0,
    orders: new Map(),
    userOrderCount: new Map(),
    userOrders: new Map(),
  };

  private ERR_UNAUTHORIZED = 100;
  private ERR_INVALID_AMOUNT = 101;
  private ERR_INVALID_PRICE = 102;
  private ERR_ORDER_NOT_FOUND = 103;
  private ERR_PAUSED = 105;
  private ERR_INVALID_EXPIRY = 114;
  private ERR_MAX_ORDERS_REACHED = 115;
  private ERR_SELF_TRADE = 112;
  private ERR_ORDER_EXPIRED = 113;
  private ERR_ORDER_ALREADY_FILLED = 107;
  private ERR_COMPLIANCE_FAIL = 108;
  private ERR_ORACLE_FAIL = 109;

  private ORDER_TYPE_BUY = 1;
  private ORDER_TYPE_SELL = 2;
  private MAX_ORDERS_PER_USER = 50;
  private MIN_ORDER_AMOUNT = 1;
  private MIN_ORDER_PRICE = 1;

  private currentBlockHeight = 100; // Mock block height

  // For testing, allow setting block height
  setBlockHeight(height: number) {
    this.currentBlockHeight = height;
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  setAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  createBuyOrder(caller: string, amount: number, price: number, expiry: number): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!mockExternal.isRegistered(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (amount < this.MIN_ORDER_AMOUNT) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (price < this.MIN_ORDER_PRICE) {
      return { ok: false, value: this.ERR_INVALID_PRICE };
    }
    if (expiry <= this.currentBlockHeight) {
      return { ok: false, value: this.ERR_INVALID_EXPIRY };
    }
    if (!mockExternal.getOracleValidation(caller)) {
      return { ok: false, value: this.ERR_ORACLE_FAIL };
    }
    // Assume escrow lock succeeds
    if (!mockExternal.lockStx().ok) {
      return { ok: false, value: 110 }; // ERR_ESCROW_FAIL
    }
    const orderId = ++this.state.orderCounter;
    this.state.orders.set(orderId, {
      creator: caller,
      orderType: this.ORDER_TYPE_BUY,
      amount,
      price,
      filled: 0,
      expiry,
      active: true,
    });
    const userOrders = this.state.userOrders.get(caller) ?? new Map();
    const count = this.state.userOrderCount.get(caller) ?? 0;
    if (count >= this.MAX_ORDERS_PER_USER) {
      return { ok: false, value: this.ERR_MAX_ORDERS_REACHED };
    }
    userOrders.set(count, orderId);
    this.state.userOrders.set(caller, userOrders);
    this.state.userOrderCount.set(caller, count + 1);
    return { ok: true, value: orderId };
  }

  createSellOrder(caller: string, amount: number, price: number, expiry: number): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!mockExternal.isRegistered(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (amount < this.MIN_ORDER_AMOUNT) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (price < this.MIN_ORDER_PRICE) {
      return { ok: false, value: this.ERR_INVALID_PRICE };
    }
    if (expiry <= this.currentBlockHeight) {
      return { ok: false, value: this.ERR_INVALID_EXPIRY };
    }
    if (!mockExternal.getOracleValidation(caller)) {
      return { ok: false, value: this.ERR_ORACLE_FAIL };
    }
    // Assume escrow lock succeeds
    if (!mockExternal.lockTokens().ok) {
      return { ok: false, value: 110 }; // ERR_ESCROW_FAIL
    }
    const orderId = ++this.state.orderCounter;
    this.state.orders.set(orderId, {
      creator: caller,
      orderType: this.ORDER_TYPE_SELL,
      amount,
      price,
      filled: 0,
      expiry,
      active: true,
    });
    const userOrders = this.state.userOrders.get(caller) ?? new Map();
    const count = this.state.userOrderCount.get(caller) ?? 0;
    if (count >= this.MAX_ORDERS_PER_USER) {
      return { ok: false, value: this.ERR_MAX_ORDERS_REACHED };
    }
    userOrders.set(count, orderId);
    this.state.userOrders.set(caller, userOrders);
    this.state.userOrderCount.set(caller, count + 1);
    return { ok: true, value: orderId };
  }

  cancelOrder(caller: string, orderId: number): ClarityResponse<boolean> {
    const order = this.state.orders.get(orderId);
    if (!order) {
      return { ok: false, value: this.ERR_ORDER_NOT_FOUND };
    }
    if (caller !== order.creator) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (!order.active) {
      return { ok: false, value: this.ERR_ORDER_ALREADY_FILLED };
    }
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    order.active = false;
    this.state.orders.set(orderId, order);
    // Assume release succeeds
    return { ok: true, value: true };
  }

  fillOrder(caller: string, orderId: number, fillAmount: number): ClarityResponse<boolean> {
    const order = this.state.orders.get(orderId);
    if (!order) {
      return { ok: false, value: this.ERR_ORDER_NOT_FOUND };
    }
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!order.active) {
      return { ok: false, value: this.ERR_ORDER_ALREADY_FILLED };
    }
    const remaining = order.amount - order.filled;
    if (fillAmount > remaining) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (caller === order.creator) {
      return { ok: false, value: this.ERR_SELF_TRADE };
    }
    if (!mockExternal.isRegistered(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (this.currentBlockHeight >= order.expiry) {
      return { ok: false, value: this.ERR_ORDER_EXPIRED };
    }
    if (!mockExternal.checkCompliance(caller, order.creator, fillAmount, order.price)) {
      return { ok: false, value: this.ERR_COMPLIANCE_FAIL };
    }
    if (!mockExternal.getOracleValidation(caller)) {
      return { ok: false, value: this.ERR_ORACLE_FAIL };
    }
    // Assume transfers and settle succeed
    order.filled += fillAmount;
    if (order.filled === order.amount) {
      order.active = false;
    }
    this.state.orders.set(orderId, order);
    return { ok: true, value: true };
  }

  getOrder(orderId: number): ClarityResponse<Order | null> {
    return { ok: true, value: this.state.orders.get(orderId) ?? null };
  }

  getUserOrderCount(user: string): ClarityResponse<number> {
    return { ok: true, value: this.state.userOrderCount.get(user) ?? 0 };
  }

  getUserOrder(user: string, index: number): ClarityResponse<number | null> {
    const userOrders = this.state.userOrders.get(user);
    return { ok: true, value: userOrders?.get(index) ?? null };
  }

  isContractPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getAdmin(): ClarityResponse<string> {
    return { ok: true, value: this.state.admin };
  }

  getOrderCounter(): ClarityResponse<number> {
    return { ok: true, value: this.state.orderCounter };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  countryA: "country_a",
  countryB: "country_b",
  unauthorized: "unauthorized",
};

describe("Exchange Contract", () => {
  let contract: ExchangeMock;

  beforeEach(() => {
    contract = new ExchangeMock();
    vi.resetAllMocks();
    contract.setBlockHeight(100);
  });

  it("should initialize correctly", () => {
    expect(contract.isContractPaused()).toEqual({ ok: true, value: false });
    expect(contract.getAdmin()).toEqual({ ok: true, value: "deployer" });
    expect(contract.getOrderCounter()).toEqual({ ok: true, value: 0 });
  });

  it("should allow admin to pause and unpause", () => {
    const pause = contract.pauseContract(accounts.deployer);
    expect(pause).toEqual({ ok: true, value: true });
    expect(contract.isContractPaused()).toEqual({ ok: true, value: true });

    const unpause = contract.unpauseContract(accounts.deployer);
    expect(unpause).toEqual({ ok: true, value: true });
    expect(contract.isContractPaused()).toEqual({ ok: true, value: false });
  });

  it("should prevent non-admin from pausing", () => {
    const pause = contract.pauseContract(accounts.countryA);
    expect(pause).toEqual({ ok: false, value: 100 });
  });

  it("should create buy order successfully", () => {
    const create = contract.createBuyOrder(accounts.countryA, 100, 10, 200);
    expect(create).toEqual({ ok: true, value: 1 });
    const order = contract.getOrder(1);
    expect(order).toEqual({
      ok: true,
      value: expect.objectContaining({
        creator: accounts.countryA,
        orderType: 1,
        amount: 100,
        price: 10,
        filled: 0,
        expiry: 200,
        active: true,
      }),
    });
    expect(contract.getUserOrderCount(accounts.countryA)).toEqual({ ok: true, value: 1 });
    expect(contract.getUserOrder(accounts.countryA, 0)).toEqual({ ok: true, value: 1 });
  });

  it("should prevent buy order with invalid amount", () => {
    const create = contract.createBuyOrder(accounts.countryA, 0, 10, 200);
    expect(create).toEqual({ ok: false, value: 101 });
  });

  it("should prevent buy order when paused", () => {
    contract.pauseContract(accounts.deployer);
    const create = contract.createBuyOrder(accounts.countryA, 100, 10, 200);
    expect(create).toEqual({ ok: false, value: 105 });
  });

  it("should create sell order successfully", () => {
    const create = contract.createSellOrder(accounts.countryA, 100, 10, 200);
    expect(create).toEqual({ ok: true, value: 1 });
    const order = contract.getOrder(1);
    expect(order).toEqual({
      ok: true,
      value: expect.objectContaining({
        creator: accounts.countryA,
        orderType: 2,
        amount: 100,
        price: 10,
        filled: 0,
        expiry: 200,
        active: true,
      }),
    });
  });

  it("should cancel order successfully", () => {
    contract.createSellOrder(accounts.countryA, 100, 10, 200);
    const cancel = contract.cancelOrder(accounts.countryA, 1);
    expect(cancel).toEqual({ ok: true, value: true });
    const order = contract.getOrder(1);
    expect(order.value?.active).toBe(false);
  });

  it("should prevent canceling non-owned order", () => {
    contract.createSellOrder(accounts.countryA, 100, 10, 200);
    const cancel = contract.cancelOrder(accounts.countryB, 1);
    expect(cancel).toEqual({ ok: false, value: 100 });
  });

  it("should fill order successfully", () => {
    contract.createSellOrder(accounts.countryA, 100, 10, 200);
    const fill = contract.fillOrder(accounts.countryB, 1, 50);
    expect(fill).toEqual({ ok: true, value: true });
    const order = contract.getOrder(1);
    expect(order.value?.filled).toBe(50);
    expect(order.value?.active).toBe(true);
  });

  it("should complete order when fully filled", () => {
    contract.createSellOrder(accounts.countryA, 100, 10, 200);
    const fill = contract.fillOrder(accounts.countryB, 1, 100);
    expect(fill).toEqual({ ok: true, value: true });
    const order = contract.getOrder(1);
    expect(order.value?.filled).toBe(100);
    expect(order.value?.active).toBe(false);
  });

  it("should prevent filling expired order", () => {
    contract.createSellOrder(accounts.countryA, 100, 10, 200);
    contract.setBlockHeight(201);
    const fill = contract.fillOrder(accounts.countryB, 1, 50);
    expect(fill).toEqual({ ok: false, value: 113 });
  });

  it("should prevent self-trade", () => {
    contract.createSellOrder(accounts.countryA, 100, 10, 200);
    const fill = contract.fillOrder(accounts.countryA, 1, 50);
    expect(fill).toEqual({ ok: false, value: 112 });
  });

  it("should enforce max orders per user", () => {
    for (let i = 0; i < 50; i++) {
      contract.createBuyOrder(accounts.countryA, 100, 10, 200);
    }
    const create = contract.createBuyOrder(accounts.countryA, 100, 10, 200);
    expect(create).toEqual({ ok: false, value: 115 });
  });

  it("should prevent unauthorized user from creating order", () => {
    vi.spyOn(mockExternal, "isRegistered").mockReturnValueOnce(false);
    const create = contract.createBuyOrder(accounts.unauthorized, 100, 10, 200);
    expect(create).toEqual({ ok: false, value: 100 });
  });

  it("should prevent order with failed oracle validation", () => {
    vi.spyOn(mockExternal, "getOracleValidation").mockReturnValueOnce(false);
    const create = contract.createBuyOrder(accounts.countryA, 100, 10, 200);
    expect(create).toEqual({ ok: false, value: 109 });
  });

  it("should prevent fill with failed compliance", () => {
    contract.createSellOrder(accounts.countryA, 100, 10, 200);
    vi.spyOn(mockExternal, "checkCompliance").mockReturnValueOnce(false);
    const fill = contract.fillOrder(accounts.countryB, 1, 50);
    expect(fill).toEqual({ ok: false, value: 108 });
  });
});