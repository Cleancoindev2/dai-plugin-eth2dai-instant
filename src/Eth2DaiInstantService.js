import { PrivateService } from '@makerdao/services-core';
import { getCurrency, WETH, DAI, ETH } from './Currency';
import { OtcSellOrder, OtcBuyOrder } from './OtcOrder';

export default class Eth2DaiInstant extends PrivateService {
  constructor(name = 'exchange') {
    super(name, [
      'proxy',
      'smartContract',
      'token',
      'cdp',
      'web3',
      'transactionManager',
      'allowance'
    ]);
    this._slippage = 0.02;
  }

  async sell(sell, buy, amount) {
    const proxy = await this._checkProxy(sell);
    const method = this._setMethod(sell, buy, 'sellAllAmount', proxy);
    const sellToken = sell === 'ETH' ? 'WETH' : sell;
    const buyToken = buy === 'ETH' ? 'WETH' : buy;
    const minFillAmount = await this._minBuyAmount(buyToken, sellToken, amount);
    const params = this._buildParams(
      sellToken,
      amount,
      buyToken,
      minFillAmount,
      method
    );
    const options = this._buildOptions(amount, sell, method);

    if (proxy) await this.get('allowance').requireAllowance(sellToken, proxy);
    return OtcSellOrder.build(
      this._otcProxy(),
      method,
      params,
      this.get('transactionManager'),
      buyToken === 'DAI' ? DAI : WETH,
      options
    );
  }

  async buy(buy, sell, amount) {
    const proxy = await this._checkProxy(sell);
    const method = this._setMethod(sell, buy, 'buyAllAmount', proxy);
    const buyToken = buy === 'ETH' ? 'WETH' : buy;
    const sellToken = sell === 'ETH' ? 'WETH' : sell;
    const maxPayAmount = await this._maxPayAmount(sellToken, buyToken, amount);
    const params = this._buildParams(
      buyToken,
      amount,
      sellToken,
      maxPayAmount,
      method
    );
    const options = this._buildOptions(amount, sell, method, maxPayAmount);

    if (proxy) await this.get('allowance').requireAllowance(sellToken, proxy);
    return OtcBuyOrder.build(
      this._otcProxy(),
      method,
      params,
      this.get('transactionManager'),
      options
    );
  }

  setSlippageLimit(limit) {
    this._slippage = limit;
  }

  async getBuyAmount(buyToken, payToken, sellAmount) {
    this._buyAmount = await this._otc().getBuyAmount(
      this._getTokenAddress(buyToken),
      this._getTokenAddress(payToken),
      this._valueForContract(sellAmount, buyToken)
    );
    return this._buyAmount;
  }

  async getPayAmount(payToken, buyToken, buyAmount) {
    this._payAmount = await this._otc().getPayAmount(
      this._getTokenAddress(payToken),
      this._getTokenAddress(buyToken),
      this._valueForContract(buyAmount, buyToken)
    );
    return this._payAmount;
  }

  async _minBuyAmount(buyToken, payToken, payAmount) {
    const buyAmount = this._buyAmount
      ? this._buyAmount
      : await this.getBuyAmount(buyToken, payToken, payAmount);
    const adjustedAmount = buyAmount * (1 - this._slippage);
    return ETH.wei(adjustedAmount).toFixed('wei');
  }

  async _maxPayAmount(payToken, buyToken, buyAmount) {
    const payAmount = this._payAmount
      ? this._payAmount
      : await this.getPayAmount(payToken, buyToken, buyAmount);
    const adjustedAmount = payAmount * (1 + this._slippage);
    return ETH.wei(adjustedAmount).toFixed('wei');
  }

  // The only atomic createAndExecute functions that work
  // are payEth orders, because the createAndExecute
  // functions themselves cannot be `payable` with ERC20
  // tokens. _checkProxy is necessary to determine
  // whether a proxy should be built first (as a separate
  // transaction) or if it can be done atomically
  async _checkProxy(sellCurrency) {
    const proxy = await this.get('proxy').currentProxy();

    if (proxy) {
      return proxy;
    } else if (sellCurrency !== 'ETH') {
      return await this.get('proxy').ensureProxy();
    } else {
      return false;
    }
  }

  _setMethod(sellToken, buyToken, method, proxy) {
    if (buyToken === 'ETH') {
      return (method += 'BuyEth');
    } else if (sellToken === 'ETH' && !proxy) {
      return (
        'createAnd' +
        method.charAt(0).toUpperCase() +
        method.slice(1) +
        'PayEth'
      );
    } else if (sellToken === 'ETH') {
      return (method += 'PayEth');
    } else {
      return method;
    }
  }

  _buildParams(sendToken, amount, buyToken, limit, method) {
    const otcAddress = this._otc().address;
    const daiAddress = this._getTokenAddress('DAI');
    const wethAddress = this._getTokenAddress('WETH');
    const orderAmount = this._valueForContract(amount, sendToken);
    const registryAddress = this.get('smartContract').getContractByName(
      'PROXY_REGISTRY'
    ).address;

    switch (method) {
      case 'sellAllAmountPayEth':
        return [otcAddress, wethAddress, daiAddress, limit];
      case 'createAndSellAllAmountPayEth':
        return [registryAddress, otcAddress, daiAddress, limit];
      case 'buyAllAmountPayEth':
        return [otcAddress, daiAddress, orderAmount, wethAddress];
      case 'createAndBuyAllAmountPayEth':
        return [registryAddress, otcAddress, daiAddress, orderAmount];
      default:
        return [
          otcAddress,
          this._getTokenAddress(sendToken),
          orderAmount,
          this._getTokenAddress(buyToken),
          limit
        ];
    }
  }

  _buildOptions(amount, sellToken, method, maxPayAmount) {
    const options = {};
    options.otc = this._otc();
    if (!method.includes('create')) options.dsProxy = true;
    if (method.toLowerCase().includes('buyallamountpayeth')) {
      options.value = maxPayAmount;
    } else if (sellToken === 'ETH') {
      options.value = this._valueForContract(amount, 'WETH');
    }
    return options;
  }

  _getTokenAddress(token) {
    return this.get('token')
      .getToken(token)
      .address();
  }

  _otcProxy() {
    return this.get('smartContract').getContractByName('OASIS_PROXY');
  }

  _otc() {
    return this.get('smartContract').getContractByName('MAKER_OTC');
  }

  _valueForContract(amount, symbol) {
    const token = this.get('token').getToken(symbol);
    return getCurrency(amount, token).toFixed('wei');
  }
}
