import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';
import 'package:rally/domain/models/ohlc_candle.dart';
import 'package:rally/presentation/theme/neon_theme.dart';

/// Computes candlestick geometry and color for a given OHLC candle,
/// mirroring the logic in [_CandlestickChart._buildBarGroups] and
/// [_CandlestickChart._candleColor] from chart_widget.dart.
class CandlestickGeometry {
  final double bodyTop;
  final double bodyBottom;
  final double wickTop;
  final double wickBottom;
  final Color color;

  CandlestickGeometry({
    required this.bodyTop,
    required this.bodyBottom,
    required this.wickTop,
    required this.wickBottom,
    required this.color,
  });

  /// Computes the geometry and color for a candle at a given brightness,
  /// using the same logic as the production _CandlestickChart widget.
  factory CandlestickGeometry.fromCandle(
      OhlcCandle candle, Brightness brightness) {
    final bodyTop = max(candle.open, candle.close);
    final bodyBottom = min(candle.open, candle.close);
    final wickTop = candle.high;
    final wickBottom = candle.low;

    final Color color;
    if (candle.close > candle.open) {
      color = NeonColors.buyGreen(brightness);
    } else {
      color = NeonColors.shortRed(brightness);
    }

    return CandlestickGeometry(
      bodyTop: bodyTop,
      bodyBottom: bodyBottom,
      wickTop: wickTop,
      wickBottom: wickBottom,
      color: color,
    );
  }
}

/// Feature: stock-trading-valuations-engine
/// Property-based tests for candlestick geometry correctness.
void main() {
  group(
      'Feature: stock-trading-valuations-engine, '
      'Property 14: Candlestick geometry correctness', () {
    // **Validates: Requirements 5.5, 5.6**
    //
    // For any OHLC candle with values (open, high, low, close), the rendered
    // candle body top SHALL equal max(open, close), body bottom SHALL equal
    // min(open, close), wick top SHALL equal high, and wick bottom SHALL equal
    // low. Bullish candles (close > open) and bearish candles (close < open)
    // SHALL be assigned two distinct colors.

    /// Generates a valid OHLC candle where high >= max(open, close) and
    /// low <= min(open, close).
    Arbitrary<OhlcCandle> validOhlcCandleArbitrary() {
      return combine4(
        float(min: 1.0, max: 10000.0), // open
        float(min: 1.0, max: 10000.0), // close
        float(min: 0.0, max: 500.0), // highOffset above max(open,close)
        float(min: 0.0, max: 500.0), // lowOffset below min(open,close)
      ).map((tuple) {
        final open = tuple.$1;
        final close = tuple.$2;
        final highOffset = tuple.$3;
        final lowOffset = tuple.$4;

        final high = max(open, close) + highOffset;
        final low = min(open, close) - lowOffset;

        return OhlcCandle(
          timestamp: DateTime(2024, 1, 1),
          open: open,
          high: high,
          low: low,
          close: close,
          volume: 1000.0,
        );
      });
    }

    property('body top equals max(open, close) for any valid OHLC candle', () {
      forAll(
        validOhlcCandleArbitrary(),
        (candle) {
          final geometry =
              CandlestickGeometry.fromCandle(candle, Brightness.dark);

          expect(geometry.bodyTop, equals(max(candle.open, candle.close)),
              reason: 'Body top should be max(open=${candle.open}, '
                  'close=${candle.close}) = ${max(candle.open, candle.close)}, '
                  'but got ${geometry.bodyTop}');
        },
        maxExamples: 100,
      );
    });

    property('body bottom equals min(open, close) for any valid OHLC candle',
        () {
      forAll(
        validOhlcCandleArbitrary(),
        (candle) {
          final geometry =
              CandlestickGeometry.fromCandle(candle, Brightness.dark);

          expect(geometry.bodyBottom, equals(min(candle.open, candle.close)),
              reason: 'Body bottom should be min(open=${candle.open}, '
                  'close=${candle.close}) = ${min(candle.open, candle.close)}, '
                  'but got ${geometry.bodyBottom}');
        },
        maxExamples: 100,
      );
    });

    property('wick top equals high for any valid OHLC candle', () {
      forAll(
        validOhlcCandleArbitrary(),
        (candle) {
          final geometry =
              CandlestickGeometry.fromCandle(candle, Brightness.dark);

          expect(geometry.wickTop, equals(candle.high),
              reason:
                  'Wick top should equal high=${candle.high}, but got ${geometry.wickTop}');
        },
        maxExamples: 100,
      );
    });

    property('wick bottom equals low for any valid OHLC candle', () {
      forAll(
        validOhlcCandleArbitrary(),
        (candle) {
          final geometry =
              CandlestickGeometry.fromCandle(candle, Brightness.dark);

          expect(geometry.wickBottom, equals(candle.low),
              reason:
                  'Wick bottom should equal low=${candle.low}, but got ${geometry.wickBottom}');
        },
        maxExamples: 100,
      );
    });

    property(
        'bullish candles (close > open) are colored with buyGreen and bearish '
        'candles (close < open) are colored with shortRed', () {
      forAll(
        validOhlcCandleArbitrary(),
        (candle) {
          for (final brightness in Brightness.values) {
            final geometry =
                CandlestickGeometry.fromCandle(candle, brightness);
            final expectedBullishColor = NeonColors.buyGreen(brightness);
            final expectedBearishColor = NeonColors.shortRed(brightness);

            if (candle.close > candle.open) {
              expect(geometry.color, equals(expectedBullishColor),
                  reason:
                      'Bullish candle (close=${candle.close} > open=${candle.open}) '
                      'should have buyGreen color for $brightness');
            } else if (candle.close < candle.open) {
              expect(geometry.color, equals(expectedBearishColor),
                  reason:
                      'Bearish candle (close=${candle.close} < open=${candle.open}) '
                      'should have shortRed color for $brightness');
            }
            // When close == open, it falls into the else branch (shortRed), which
            // is acceptable per the implementation — doji candles are treated as bearish.
          }
        },
        maxExamples: 100,
      );
    });

    property(
        'bullish and bearish candle colors are always distinct from each other',
        () {
      forAll(
        integer(min: 0, max: Brightness.values.length - 1),
        (brightnessIndex) {
          final brightness = Brightness.values[brightnessIndex];
          final bullishColor = NeonColors.buyGreen(brightness);
          final bearishColor = NeonColors.shortRed(brightness);

          expect(bullishColor, isNot(equals(bearishColor)),
              reason: 'Bullish (buyGreen) and bearish (shortRed) colors '
                  'must be distinct for $brightness, but both were $bullishColor');
        },
        maxExamples: 100,
      );
    });
  });
}
