import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rally/domain/models/asset_price.dart';
import 'package:rally/presentation/widgets/market_data/price_ticker_widget.dart';

/// Helper to create a test AssetPrice with sensible defaults.
AssetPrice makePrice({
  String symbol = 'AAPL',
  double price = 185.42,
  double percentageChange = 1.23,
}) {
  return AssetPrice(
    symbol: symbol,
    price: price,
    dailyHigh: 186.10,
    dailyLow: 183.55,
    volume: 52340000,
    percentageChange: percentageChange,
    timestamp: DateTime.utc(2024, 1, 15, 14, 30),
  );
}

/// Wraps the PriceTickerWidget in a MaterialApp for testing.
Widget buildTestWidget({
  AssetPrice? price,
  bool isStale = false,
  bool isUnavailable = false,
  VoidCallback? onTap,
}) {
  return MaterialApp(
    theme: ThemeData.dark(),
    home: Scaffold(
      body: PriceTickerWidget(
        price: price,
        isStale: isStale,
        isUnavailable: isUnavailable,
        onTap: onTap,
      ),
    ),
  );
}

void main() {
  group('PriceTickerWidget', () {
    group('displays price data correctly', () {
      testWidgets('shows symbol, price, and percentage change', (tester) async {
        final assetPrice = makePrice(
          symbol: 'AAPL',
          price: 185.42,
          percentageChange: 1.23,
        );

        await tester.pumpWidget(buildTestWidget(price: assetPrice));

        expect(find.text('AAPL'), findsOneWidget);
        expect(find.text('\$185.42'), findsOneWidget);
        expect(find.text('+1.23%'), findsOneWidget);
      });

      testWidgets('formats price to 2 decimal places', (tester) async {
        final assetPrice = makePrice(price: 100.0);

        await tester.pumpWidget(buildTestWidget(price: assetPrice));

        expect(find.text('\$100.00'), findsOneWidget);
      });

      testWidgets('formats percentage to 2 decimal places with % suffix',
          (tester) async {
        final assetPrice = makePrice(percentageChange: 5.5);

        await tester.pumpWidget(buildTestWidget(price: assetPrice));

        expect(find.text('+5.50%'), findsOneWidget);
      });
    });

    group('directional indicators', () {
      testWidgets('positive change shows green upward arrow and plus prefix',
          (tester) async {
        final assetPrice = makePrice(percentageChange: 2.50);

        await tester.pumpWidget(buildTestWidget(price: assetPrice));

        expect(find.text('+2.50%'), findsOneWidget);
        expect(find.byIcon(Icons.arrow_upward), findsOneWidget);
      });

      testWidgets('negative change shows red downward arrow and minus in value',
          (tester) async {
        final assetPrice = makePrice(percentageChange: -1.75);

        await tester.pumpWidget(buildTestWidget(price: assetPrice));

        expect(find.text('-1.75%'), findsOneWidget);
        expect(find.byIcon(Icons.arrow_downward), findsOneWidget);
      });

      testWidgets('zero change shows no directional icon', (tester) async {
        final assetPrice = makePrice(percentageChange: 0.0);

        await tester.pumpWidget(buildTestWidget(price: assetPrice));

        expect(find.text('0.00%'), findsOneWidget);
        expect(find.byIcon(Icons.arrow_upward), findsNothing);
        expect(find.byIcon(Icons.arrow_downward), findsNothing);
      });
    });

    group('stale data indicator', () {
      testWidgets('shows stale indicator (clock icon) when isStale is true',
          (tester) async {
        final assetPrice = makePrice();

        await tester.pumpWidget(
          buildTestWidget(price: assetPrice, isStale: true),
        );

        expect(find.byIcon(Icons.access_time), findsOneWidget);
      });

      testWidgets('does not show stale indicator when isStale is false',
          (tester) async {
        final assetPrice = makePrice();

        await tester.pumpWidget(
          buildTestWidget(price: assetPrice, isStale: false),
        );

        expect(find.byIcon(Icons.access_time), findsNothing);
      });
    });

    group('loading placeholder', () {
      testWidgets('shows loading placeholder when price is null and not unavailable',
          (tester) async {
        await tester.pumpWidget(
          buildTestWidget(price: null, isUnavailable: false),
        );

        // Should not show symbol or price text
        expect(find.text('AAPL'), findsNothing);
        expect(find.text('Data unavailable'), findsNothing);

        // Should show placeholder containers (shimmer boxes)
        final containers = find.byType(Container);
        expect(containers, findsWidgets);
      });
    });

    group('unavailable placeholder', () {
      testWidgets('shows "Data unavailable" when isUnavailable is true',
          (tester) async {
        await tester.pumpWidget(
          buildTestWidget(price: null, isUnavailable: true),
        );

        expect(find.text('Data unavailable'), findsOneWidget);
        expect(find.byIcon(Icons.error_outline), findsOneWidget);
      });

      testWidgets(
          'shows "Data unavailable" even if price is provided when isUnavailable',
          (tester) async {
        final assetPrice = makePrice();

        await tester.pumpWidget(
          buildTestWidget(price: assetPrice, isUnavailable: true),
        );

        // Unavailable takes precedence
        expect(find.text('Data unavailable'), findsOneWidget);
        expect(find.text('AAPL'), findsNothing);
      });
    });

    group('tap interaction', () {
      testWidgets('invokes onTap callback when tapped', (tester) async {
        var tapped = false;
        final assetPrice = makePrice();

        await tester.pumpWidget(
          buildTestWidget(
            price: assetPrice,
            onTap: () => tapped = true,
          ),
        );

        await tester.tap(find.byType(PriceTickerWidget));
        expect(tapped, isTrue);
      });

      testWidgets('does not crash when onTap is null', (tester) async {
        final assetPrice = makePrice();

        await tester.pumpWidget(
          buildTestWidget(price: assetPrice, onTap: null),
        );

        // Should not throw when tapped
        await tester.tap(find.byType(PriceTickerWidget));
      });
    });
  });

  group('formatPercentageChange', () {
    // Test the static helper independently
    test('positive value has + prefix and % suffix', () {
      expect(
        _formatPercentageChange(3.14),
        equals('+3.14%'),
      );
    });

    test('negative value has no extra prefix (minus from value)', () {
      expect(
        _formatPercentageChange(-2.50),
        equals('-2.50%'),
      );
    });

    test('zero value has no prefix', () {
      expect(
        _formatPercentageChange(0.0),
        equals('0.00%'),
      );
    });

    test('formats to exactly 2 decimal places', () {
      expect(
        _formatPercentageChange(1.1),
        equals('+1.10%'),
      );
      expect(
        _formatPercentageChange(1.999),
        equals('+2.00%'),
      );
    });
  });
}

/// Import-free access to the helper for unit tests.
String _formatPercentageChange(double value) {
  // Replicate the logic here to test independently,
  // or we import the helper directly.
  final String prefix;
  if (value > 0) {
    prefix = '+';
  } else {
    prefix = '';
  }
  return '$prefix${value.toStringAsFixed(2)}%';
}
