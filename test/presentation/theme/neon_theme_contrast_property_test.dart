import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';
import 'package:rally/presentation/theme/neon_theme.dart';

/// Calculates the relative luminance of a color according to WCAG 2.1.
/// https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
double _relativeLuminance(Color color) {
  double linearize(double channel) {
    return channel <= 0.03928
        ? channel / 12.92
        : pow((channel + 0.055) / 1.055, 2.4).toDouble();
  }

  final r = linearize(color.r);
  final g = linearize(color.g);
  final b = linearize(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/// Calculates the WCAG 2.1 contrast ratio between two colors.
/// Returns a value between 1.0 and 21.0.
double _contrastRatio(Color foreground, Color background) {
  final lumFg = _relativeLuminance(foreground);
  final lumBg = _relativeLuminance(background);
  final lighter = max(lumFg, lumBg);
  final darker = min(lumFg, lumBg);
  return (lighter + 0.05) / (darker + 0.05);
}

/// All text-background color pairs that must meet 4.5:1 contrast.
/// Each entry is (foreground text color, background color, description).
List<(Color, Color, String)> _textColorPairs(Brightness brightness) {
  if (brightness == Brightness.dark) {
    return [
      (NeonColors.darkOnBackground, NeonColors.darkBackground, 'primary text on dark background'),
      (NeonColors.darkOnSurface, NeonColors.darkSurface, 'surface text on dark surface'),
      (NeonColors.darkBuyGreen, NeonColors.darkBackground, 'buy green text on dark background'),
      (NeonColors.darkShortRed, NeonColors.darkBackground, 'short red text on dark background'),
      (NeonColors.darkAccent, NeonColors.darkBackground, 'accent text on dark background'),
      (NeonColors.darkOnBackground, NeonColors.darkSurface, 'primary text on dark surface'),
    ];
  } else {
    return [
      (NeonColors.lightOnBackground, NeonColors.lightBackground, 'primary text on light background'),
      (NeonColors.lightOnSurface, NeonColors.lightSurface, 'surface text on light surface'),
      (NeonColors.lightBuyGreen, NeonColors.lightBackground, 'buy green text on light background'),
      (NeonColors.lightShortRed, NeonColors.lightBackground, 'short red text on light background'),
      (NeonColors.lightAccent, NeonColors.lightBackground, 'accent text on light background'),
      (NeonColors.lightOnBackground, NeonColors.lightSurface, 'primary text on light surface'),
    ];
  }
}

/// All non-text UI component color pairs that must meet 3:1 contrast.
/// (component color, adjacent background color, description)
List<(Color, Color, String)> _nonTextColorPairs(Brightness brightness) {
  if (brightness == Brightness.dark) {
    return [
      (NeonColors.darkBuyGreen, NeonColors.darkSurface, 'buy green button on dark surface'),
      (NeonColors.darkShortRed, NeonColors.darkSurface, 'short red button on dark surface'),
      (NeonColors.darkAccent, NeonColors.darkSurface, 'accent button on dark surface'),
      (NeonColors.darkBuyGreen, NeonColors.darkBackground, 'buy green icon on dark background'),
      (NeonColors.darkShortRed, NeonColors.darkBackground, 'short red icon on dark background'),
      (NeonColors.darkAccent, NeonColors.darkBackground, 'accent icon on dark background'),
    ];
  } else {
    return [
      (NeonColors.lightBuyGreen, NeonColors.lightBackground, 'buy green button on light background'),
      (NeonColors.lightShortRed, NeonColors.lightBackground, 'short red button on light background'),
      (NeonColors.lightAccent, NeonColors.lightBackground, 'accent button on light background'),
      (NeonColors.lightBuyGreen, NeonColors.lightSurface, 'buy green icon on light surface'),
      (NeonColors.lightShortRed, NeonColors.lightSurface, 'short red icon on light surface'),
      (NeonColors.lightAccent, NeonColors.lightSurface, 'accent icon on light surface'),
    ];
  }
}

/// Feature: stock-trading-valuations-engine
/// Property-based tests for Color Contrast Accessibility (Property 17)
void main() {
  group(
      'Feature: stock-trading-valuations-engine, '
      'Property 17: Color contrast accessibility', () {
    // **Validates: Requirements 8.4, 8.5**
    //
    // For any text-background color pair in both light and dark themes, the
    // WCAG contrast ratio SHALL be at least 4.5:1. For any non-text UI
    // component (buttons, icons, chart elements) and its adjacent color, the
    // contrast ratio SHALL be at least 3:1. These ratios SHALL hold with
    // neon glow effects active.

    property(
        'all text-background color pairs meet 4.5:1 contrast in both themes',
        () {
      // Generate random theme selection (0 = dark, 1 = light) to exercise
      // both themes across iterations
      forAll(
        integer(min: 0, max: 1),
        (themeIndex) {
          final brightness =
              themeIndex == 0 ? Brightness.dark : Brightness.light;
          final pairs = _textColorPairs(brightness);

          for (final (foreground, background, description) in pairs) {
            final ratio = _contrastRatio(foreground, background);
            expect(
              ratio,
              greaterThanOrEqualTo(4.5),
              reason: 'Text contrast for "$description" is $ratio, '
                  'expected >= 4.5:1. '
                  'FG: ${foreground.value.toRadixString(16)}, '
                  'BG: ${background.value.toRadixString(16)}',
            );
          }
        },
        maxExamples: 100,
      );
    });

    property(
        'all non-text UI components meet 3:1 contrast in both themes', () {
      forAll(
        integer(min: 0, max: 1),
        (themeIndex) {
          final brightness =
              themeIndex == 0 ? Brightness.dark : Brightness.light;
          final pairs = _nonTextColorPairs(brightness);

          for (final (component, adjacent, description) in pairs) {
            final ratio = _contrastRatio(component, adjacent);
            expect(
              ratio,
              greaterThanOrEqualTo(3.0),
              reason: 'Non-text contrast for "$description" is $ratio, '
                  'expected >= 3:1. '
                  'Component: ${component.value.toRadixString(16)}, '
                  'Adjacent: ${adjacent.value.toRadixString(16)}',
            );
          }
        },
        maxExamples: 100,
      );
    });

    property(
        'neon glow effects do not degrade text contrast below 4.5:1', () {
      // Glow effects are rendered as box shadows behind elements,
      // so the effective text contrast is between the button's foreground
      // text and its solid background — not the glow color.
      // We verify that the button text on button background still meets 4.5:1.
      forAll(
        integer(min: 0, max: 1),
        (themeIndex) {
          final brightness =
              themeIndex == 0 ? Brightness.dark : Brightness.light;

          // Elevated button: foreground text on button background
          // In both themes, buttons use accent color as background and
          // the respective background color as text (onPrimary).
          final Color buttonBg;
          final Color buttonFg;
          final Color glowColor;

          if (brightness == Brightness.dark) {
            buttonBg = NeonColors.darkAccent;
            buttonFg = NeonColors.darkBackground;
            glowColor = NeonColors.darkAccent;
          } else {
            buttonBg = NeonColors.lightAccent;
            buttonFg = NeonColors.lightBackground;
            glowColor = NeonColors.lightAccent;
          }

          // Verify button text contrast with glow active
          // The glow is a shadow behind the element, so button text is
          // rendered against the solid buttonBg, not the glow.
          final buttonTextRatio = _contrastRatio(buttonFg, buttonBg);
          expect(
            buttonTextRatio,
            greaterThanOrEqualTo(4.5),
            reason: 'Button text contrast with glow active is '
                '$buttonTextRatio, expected >= 4.5:1. '
                'Theme: $brightness, glowColor: ${glowColor.value.toRadixString(16)}',
          );

          // Also verify buy/short colored buttons with glow
          final Color buyGlowBg;
          final Color buyGlowFg;
          final Color shortGlowBg;
          final Color shortGlowFg;

          if (brightness == Brightness.dark) {
            // When buy green is used as a button with glow, text is dark bg
            buyGlowBg = NeonColors.darkBuyGreen;
            buyGlowFg = NeonColors.darkBackground;
            shortGlowBg = NeonColors.darkShortRed;
            shortGlowFg = NeonColors.darkBackground;
          } else {
            buyGlowBg = NeonColors.lightBuyGreen;
            buyGlowFg = NeonColors.lightBackground;
            shortGlowBg = NeonColors.lightShortRed;
            shortGlowFg = NeonColors.lightBackground;
          }

          final buyTextRatio = _contrastRatio(buyGlowFg, buyGlowBg);
          expect(
            buyTextRatio,
            greaterThanOrEqualTo(4.5),
            reason: 'Buy button text contrast with glow active is '
                '$buyTextRatio, expected >= 4.5:1. Theme: $brightness',
          );

          final shortTextRatio = _contrastRatio(shortGlowFg, shortGlowBg);
          expect(
            shortTextRatio,
            greaterThanOrEqualTo(4.5),
            reason: 'Short button text contrast with glow active is '
                '$shortTextRatio, expected >= 4.5:1. Theme: $brightness',
          );
        },
        maxExamples: 100,
      );
    });
  });
}
