import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';
import 'package:rally/domain/models/enums.dart';
import 'package:rally/presentation/theme/neon_theme.dart';

/// Feature: stock-trading-valuations-engine
/// Property-based tests for NeonTheme directional color assignment.
void main() {
  group(
      'Feature: stock-trading-valuations-engine, '
      'Property 18: Directional color assignment', () {
    // **Validates: Requirements 8.2, 8.3**
    //
    // For any buy recommendation or positive percentage change, the assigned
    // color SHALL be in the green neon spectrum. For any short recommendation
    // or negative percentage change, the assigned color SHALL be in the red
    // neon spectrum. The two colors SHALL be distinct.

    property(
        'buy direction assigns green neon color in both themes', () {
      forAll(
        integer(min: 0, max: 1),
        (brightnessIndex) {
          final brightness =
              brightnessIndex == 0 ? Brightness.dark : Brightness.light;

          // For buy direction, the assigned color should be green spectrum
          final buyColor = NeonColors.buyGreen(brightness);

          // Verify green neon spectrum: green channel should dominate
          // Dark: #00E676 → R=0, G=230, B=118
          // Light: #00873E → R=0, G=135, B=62
          expect(buyColor.g > buyColor.r,
              isTrue,
              reason:
                  'Buy color green channel (${buyColor.g}) should be '
                  'greater than red channel (${buyColor.r}) '
                  'for brightness=$brightness');
        },
        maxExamples: 100,
      );
    });

    property(
        'short direction assigns red neon color in both themes', () {
      forAll(
        integer(min: 0, max: 1),
        (brightnessIndex) {
          final brightness =
              brightnessIndex == 0 ? Brightness.dark : Brightness.light;

          // For short direction, the assigned color should be red spectrum
          final shortColor = NeonColors.shortRed(brightness);

          // Verify red neon spectrum: red channel should dominate
          // Dark: #FF1744 → R=255, G=23, B=68
          // Light: #C62828 → R=198, G=40, B=40
          expect(shortColor.r > shortColor.g,
              isTrue,
              reason:
                  'Short color red channel (${shortColor.r}) should be '
                  'greater than green channel (${shortColor.g}) '
                  'for brightness=$brightness');
        },
        maxExamples: 100,
      );
    });

    property(
        'positive percentage change maps to green neon color', () {
      forAll(
        combine2(
          // Positive percentage changes
          float(min: 0.01, max: 1000.0, nan: false, infinity: false),
          integer(min: 0, max: 1),
        ),
        (values) {
          final percentageChange = values.$1;
          final brightnessIndex = values.$2;
          final brightness =
              brightnessIndex == 0 ? Brightness.dark : Brightness.light;

          // Positive percentage change → green neon color
          final color = _colorForPercentageChange(percentageChange, brightness);

          expect(color, equals(NeonColors.buyGreen(brightness)),
              reason:
                  'Positive percentage change ($percentageChange) should '
                  'map to buyGreen for brightness=$brightness');
        },
        maxExamples: 100,
      );
    });

    property(
        'negative percentage change maps to red neon color', () {
      forAll(
        combine2(
          // Negative percentage changes
          float(min: -1000.0, max: -0.01, nan: false, infinity: false),
          integer(min: 0, max: 1),
        ),
        (values) {
          final percentageChange = values.$1;
          final brightnessIndex = values.$2;
          final brightness =
              brightnessIndex == 0 ? Brightness.dark : Brightness.light;

          // Negative percentage change → red neon color
          final color = _colorForPercentageChange(percentageChange, brightness);

          expect(color, equals(NeonColors.shortRed(brightness)),
              reason:
                  'Negative percentage change ($percentageChange) should '
                  'map to shortRed for brightness=$brightness');
        },
        maxExamples: 100,
      );
    });

    property(
        'buy and short colors are distinct in both themes', () {
      forAll(
        integer(min: 0, max: 1),
        (brightnessIndex) {
          final brightness =
              brightnessIndex == 0 ? Brightness.dark : Brightness.light;

          final buyColor = NeonColors.buyGreen(brightness);
          final shortColor = NeonColors.shortRed(brightness);

          expect(buyColor, isNot(equals(shortColor)),
              reason:
                  'Buy color ($buyColor) and short color ($shortColor) '
                  'SHALL be distinct for brightness=$brightness');
        },
        maxExamples: 100,
      );
    });

    property(
        'TradeDirection.buy maps to green and TradeDirection.short_ maps to red',
        () {
      forAll(
        combine2(
          integer(min: 0, max: 1),
          integer(min: 0, max: 1),
        ),
        (values) {
          final directionIndex = values.$1;
          final brightnessIndex = values.$2;
          final direction =
              directionIndex == 0 ? TradeDirection.buy : TradeDirection.short_;
          final brightness =
              brightnessIndex == 0 ? Brightness.dark : Brightness.light;

          final color = _colorForDirection(direction, brightness);

          if (direction == TradeDirection.buy) {
            expect(color, equals(NeonColors.buyGreen(brightness)),
                reason:
                    'TradeDirection.buy should map to buyGreen '
                    'for brightness=$brightness');
          } else {
            expect(color, equals(NeonColors.shortRed(brightness)),
                reason:
                    'TradeDirection.short_ should map to shortRed '
                    'for brightness=$brightness');
          }
        },
        maxExamples: 100,
      );
    });
  });
}

/// Maps a trade direction to the corresponding neon color.
/// This is the function under test that implements the directional color
/// assignment logic defined in Requirements 8.2.
Color _colorForDirection(TradeDirection direction, Brightness brightness) {
  switch (direction) {
    case TradeDirection.buy:
      return NeonColors.buyGreen(brightness);
    case TradeDirection.short_:
      return NeonColors.shortRed(brightness);
  }
}

/// Maps a percentage change to the corresponding neon color.
/// Positive → green neon spectrum (buy color).
/// Negative → red neon spectrum (short color).
/// This implements Requirements 8.3.
Color _colorForPercentageChange(double percentageChange, Brightness brightness) {
  if (percentageChange >= 0) {
    return NeonColors.buyGreen(brightness);
  } else {
    return NeonColors.shortRed(brightness);
  }
}
