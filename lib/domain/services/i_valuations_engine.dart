import '../models/enums.dart';
import '../models/ohlc_candle.dart';
import '../models/price_zone.dart';
import '../models/recommendation.dart';
import '../models/reward_risk_ratio.dart';

/// Abstract interface for the valuations engine that analyzes supply/demand
/// zones and generates trade predictions.
///
/// Implements the supply and demand trading strategy by identifying zones
/// from historical data, generating recommendations when price approaches
/// zones, and tracking recommendation lifecycle.
abstract class IValuationsEngine {
  /// Identify supply zones from [historicalData].
  ///
  /// A supply zone is a price area where selling pressure historically
  /// exceeded buying pressure, determined by at least 2 prior price
  /// rejections from the zone.
  ///
  /// Returns an empty list when insufficient data is available.
  List<PriceZone> identifySupplyZones(List<OhlcCandle> historicalData);

  /// Identify demand zones from [historicalData].
  ///
  /// A demand zone is a price area where buying pressure historically
  /// exceeded selling pressure, determined by at least 2 prior price
  /// bounces from the zone.
  ///
  /// Returns an empty list when insufficient data is available.
  List<PriceZone> identifyDemandZones(List<OhlcCandle> historicalData);

  /// Generate trade recommendations based on [currentPrice] and identified
  /// zones.
  ///
  /// Generates a buy recommendation when price is within 1% of a demand
  /// zone boundary and R:R > 1.00. Generates a short recommendation when
  /// price is within 1% of a supply zone boundary and R:R > 1.00.
  ///
  /// Filters out any recommendations with incomplete data (missing entry,
  /// stop loss, or target price).
  List<Recommendation> generateRecommendations({
    required String symbol,
    required double currentPrice,
    required List<PriceZone> supplyZones,
    required List<PriceZone> demandZones,
  });

  /// Calculate the reward/risk ratio for a trade setup.
  ///
  /// For buy: (targetPrice - entryPrice) / (entryPrice - stopLossPrice)
  /// For short: (entryPrice - targetPrice) / (stopLossPrice - entryPrice)
  ///
  /// Returns an error result if entryPrice equals stopLossPrice (zero
  /// denominator).
  RewardRiskRatio calculateRewardRisk({
    required TradeDirection direction,
    required double entryPrice,
    required double targetPrice,
    required double stopLossPrice,
  });

  /// Categorize a recommendation by trade duration.
  ///
  /// - Day trade: target hold duration < 24 hours
  /// - Swing trade: target hold duration between 1 day and 2 weeks
  /// - Position trade: target hold duration > 2 weeks
  TradeCategory categorize({
    required double entryPrice,
    required double targetPrice,
    required TimeDuration timeframe,
  });

  /// Check if a [recommendation] should be marked as completed.
  ///
  /// A recommendation is completed when:
  /// - For buys: [currentPrice] reaches or exceeds targetPrice, or falls
  ///   to or below stopLossPrice
  /// - For shorts: [currentPrice] falls to or below targetPrice, or rises
  ///   to or exceeds stopLossPrice
  bool isCompleted(Recommendation recommendation, double currentPrice);
}
