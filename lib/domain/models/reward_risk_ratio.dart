import 'package:equatable/equatable.dart';

import 'enums.dart';
import 'result.dart';

/// Reward/risk ratio value object.
///
/// For buy: (target - entry) / (entry - stopLoss)
/// For short: (entry - target) / (stopLoss - entry)
class RewardRiskRatio extends Equatable {
  final double value;

  const RewardRiskRatio(this.value);

  /// Calculate the reward/risk ratio for a trade setup.
  ///
  /// Returns a [Result] containing the ratio or an error if the denominator
  /// is zero (entry == stopLoss).
  static Result<RewardRiskRatio> calculate({
    required TradeDirection direction,
    required double entryPrice,
    required double targetPrice,
    required double stopLossPrice,
  }) {
    final double denominator;
    final double numerator;

    switch (direction) {
      case TradeDirection.buy:
        numerator = targetPrice - entryPrice;
        denominator = entryPrice - stopLossPrice;
      case TradeDirection.short_:
        numerator = entryPrice - targetPrice;
        denominator = stopLossPrice - entryPrice;
    }

    if (denominator == 0) {
      return const Failure('Cannot calculate R:R: entry price equals stop loss price');
    }

    return Success(RewardRiskRatio(numerator / denominator));
  }

  /// Format as "R:R X.XX".
  String get formatted => 'R:R ${value.toStringAsFixed(2)}';

  @override
  List<Object?> get props => [value];
}
