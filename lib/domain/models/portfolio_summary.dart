import 'package:equatable/equatable.dart';

import 'holding.dart';

/// Individual holding valuation with calculated values.
class HoldingValuation extends Equatable {
  final Holding holding;

  /// Total value: currentPrice * quantity.
  final double totalValue;

  /// Unrealized gain/loss: (currentPrice - averagePurchasePrice) * quantity.
  final double unrealizedGainLoss;

  const HoldingValuation({
    required this.holding,
    required this.totalValue,
    required this.unrealizedGainLoss,
  });

  @override
  List<Object?> get props => [holding, totalValue, unrealizedGainLoss];
}

/// Portfolio summary with aggregated calculated values.
class PortfolioSummary extends Equatable {
  final List<HoldingValuation> holdings;
  final double totalValue;
  final double totalGainLoss;

  const PortfolioSummary({
    required this.holdings,
    required this.totalValue,
    required this.totalGainLoss,
  });

  @override
  List<Object?> get props => [holdings, totalValue, totalGainLoss];
}
