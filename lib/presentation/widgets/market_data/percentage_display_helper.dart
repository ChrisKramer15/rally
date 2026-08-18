import 'package:flutter/material.dart';

/// Determines the directional icon and color for a percentage change value.
///
/// - Non-negative (>= 0): up arrow icon, green color
/// - Negative (< 0): down arrow icon, red color
({IconData icon, Color color}) getPercentageDisplay(double percentageChange) {
  if (percentageChange >= 0) {
    return (icon: Icons.arrow_upward, color: Colors.greenAccent);
  } else {
    return (icon: Icons.arrow_downward, color: Colors.redAccent);
  }
}

/// Enhanced percentage display that differentiates zero from positive.
///
/// - Positive (> 0): up arrow icon, green color, '+' prefix
/// - Negative (< 0): down arrow icon, red color, no prefix (value already has minus)
/// - Zero (== 0): no icon (null), grey color, no prefix
({IconData? icon, Color color, String prefix}) getTickerPercentageDisplay(
  double percentageChange,
) {
  if (percentageChange > 0) {
    return (
      icon: Icons.arrow_upward,
      color: Colors.greenAccent,
      prefix: '+',
    );
  } else if (percentageChange < 0) {
    return (
      icon: Icons.arrow_downward,
      color: Colors.redAccent,
      prefix: '',
    );
  } else {
    return (icon: null, color: Colors.grey, prefix: '');
  }
}

/// Formats a percentage change value for display.
///
/// Returns the formatted string with:
/// - '+' prefix for positive values
/// - No prefix for negative values (already has minus sign)
/// - No prefix for zero
/// - Value formatted to exactly 2 decimal places
/// - '%' suffix
///
/// This helper is exposed as a static/testable function independent of widgets.
String formatPercentageChange(double percentageChange) {
  final display = getTickerPercentageDisplay(percentageChange);
  return '${display.prefix}${percentageChange.toStringAsFixed(2)}%';
}
