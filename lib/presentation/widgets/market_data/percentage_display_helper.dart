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
