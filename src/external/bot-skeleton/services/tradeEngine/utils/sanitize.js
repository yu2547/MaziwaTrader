import { localize } from '@deriv-com/translations';
import { createError } from '../../../utils/error';
import { api_base } from '../../api/api-base';

const isPositiveNumber = num => Number.isFinite(num) && num > 0;

const isPositiveInteger = num => isPositiveNumber(num) && Number.isInteger(num);

export const expectPositiveInteger = (num, msg) => {
    if (!isPositiveInteger(num)) {
        throw createError('PositiveIntegerExpected', msg);
    }
    return num;
};

const expectOptions = options => {
    const { symbol, contractTypes } = options;

    if (!symbol) {
        throw createError('OptionError', localize('Underlying market is not selected'));
    }

    if (!contractTypes[0]) {
        throw createError('OptionError', localize('Contract type is not selected'));
    }
};

export const expectInitArg = args => {
    const [token, options] = args;

    // The token is vestigial on this path: loginAndGetBalance() never
    // authorizes with it, it reads api_base.token/account_info for the
    // already-authorized connection. An OTP session legitimately has no
    // classic token, so an empty one is only a problem when there is no
    // authenticated transport behind it either.
    if (!token && !api_base.is_otp_transport) {
        throw createError('LoginError', localize('Please login'));
    }

    expectOptions(options);

    return args;
};

const isCandle = candle =>
    candle instanceof Object &&
    ['open', 'high', 'low', 'close'].every(key => isPositiveNumber(candle[key])) &&
    isPositiveInteger(candle.epoch);

export const expectCandle = candle => {
    if (!isCandle(candle)) {
        throw createError('CandleExpected', localize('Given candle is not valid'));
    }
    return candle;
};

export const expectCandles = candles => {
    if (!(candles instanceof Array) || !candles.every(c => isCandle(c))) {
        throw createError('CandleListExpected', localize('Given candle list is not valid'));
    }
    return candles;
};
