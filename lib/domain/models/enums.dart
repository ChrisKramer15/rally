/// Time duration options for charts.
enum TimeDuration {
  oneMin,
  fiveMin,
  fifteenMin,
  thirtyMin,
  oneHour,
  fourHour,
  eightHour,
  twelveHour,
  twentyFourHour,
  oneWeek,
  oneMonth,
  oneQuarter,
  oneYear,
  allTime;

  String get label {
    switch (this) {
      case TimeDuration.oneMin:
        return '1 min';
      case TimeDuration.fiveMin:
        return '5 min';
      case TimeDuration.fifteenMin:
        return '15 min';
      case TimeDuration.thirtyMin:
        return '30 min';
      case TimeDuration.oneHour:
        return '1 hr';
      case TimeDuration.fourHour:
        return '4 hr';
      case TimeDuration.eightHour:
        return '8 hr';
      case TimeDuration.twelveHour:
        return '12 hr';
      case TimeDuration.twentyFourHour:
        return '24 hr';
      case TimeDuration.oneWeek:
        return '1 wk';
      case TimeDuration.oneMonth:
        return '1 month';
      case TimeDuration.oneQuarter:
        return '1 qtr';
      case TimeDuration.oneYear:
        return '1 yr';
      case TimeDuration.allTime:
        return 'All';
    }
  }
}

/// Trade direction.
enum TradeDirection { buy, short_ }

/// Trade category by duration.
enum TradeCategory {
  dayTrade,
  swingTrade,
  positionTrade;

  String get label {
    switch (this) {
      case TradeCategory.dayTrade:
        return 'Day Trade';
      case TradeCategory.swingTrade:
        return 'Swing Trade';
      case TradeCategory.positionTrade:
        return 'Position Trade';
    }
  }
}

/// Chart display type.
enum ChartType { line, candlestick }

/// Price zone type.
enum ZoneType { supply, demand }

/// Connection status for market data service.
enum ConnectionStatus { connected, disconnected, reconnecting }

/// Theme mode.
enum ThemeMode { light, dark }

/// Asset type.
enum AssetType { stock, etf, crypto }

/// Recommendation status.
enum RecommendationStatus { active, completed }
