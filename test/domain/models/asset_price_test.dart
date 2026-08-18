import 'package:flutter_test/flutter_test.dart';
import 'package:rally/domain/models/asset_price.dart';
import 'package:rally/domain/models/market_data_exception.dart';

void main() {
  group('AssetPrice.fromJson', () {
    Map<String, dynamic> validJson() => {
          'symbol': 'AAPL',
          'price': 185.42,
          'dailyHigh': 186.10,
          'dailyLow': 183.55,
          'volume': 52340000,
          'percentageChange': 1.23,
          'timestamp': '2024-01-15T14:30:00Z',
        };

    group('valid parsing', () {
      test('parses all fields from valid JSON', () {
        final result = AssetPrice.fromJson(validJson());

        expect(result.symbol, 'AAPL');
        expect(result.price, 185.42);
        expect(result.dailyHigh, 186.10);
        expect(result.dailyLow, 183.55);
        expect(result.volume, 52340000.0);
        expect(result.percentageChange, 1.23);
        expect(result.timestamp, DateTime.utc(2024, 1, 15, 14, 30, 0));
      });

      test('stores int values as double via .toDouble()', () {
        final json = validJson()
          ..['price'] = 100
          ..['dailyHigh'] = 105
          ..['dailyLow'] = 95
          ..['volume'] = 1000000
          ..['percentageChange'] = 2;

        final result = AssetPrice.fromJson(json);

        expect(result.price, isA<double>());
        expect(result.price, 100.0);
        expect(result.dailyHigh, isA<double>());
        expect(result.dailyHigh, 105.0);
        expect(result.dailyLow, isA<double>());
        expect(result.dailyLow, 95.0);
        expect(result.volume, isA<double>());
        expect(result.volume, 1000000.0);
        expect(result.percentageChange, isA<double>());
        expect(result.percentageChange, 2.0);
      });

      test('normalizes non-UTC timestamp to UTC', () {
        final json = validJson()
          ..['timestamp'] = '2024-01-15T09:30:00-05:00';

        final result = AssetPrice.fromJson(json);

        expect(result.timestamp.isUtc, isTrue);
        expect(result.timestamp, DateTime.utc(2024, 1, 15, 14, 30, 0));
      });

      test('normalizes already-UTC timestamp to UTC', () {
        final json = validJson()..['timestamp'] = '2024-06-01T12:00:00Z';

        final result = AssetPrice.fromJson(json);

        expect(result.timestamp.isUtc, isTrue);
        expect(result.timestamp, DateTime.utc(2024, 6, 1, 12, 0, 0));
      });
    });

    group('missing fields validation', () {
      test('throws MarketDataException listing single missing field', () {
        final json = validJson()..remove('price');

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              contains('price'),
            ),
          ),
        );
      });

      test('throws MarketDataException listing all missing fields', () {
        final json = validJson()
          ..remove('price')
          ..remove('volume')
          ..remove('timestamp');

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              allOf(
                contains('price'),
                contains('volume'),
                contains('timestamp'),
              ),
            ),
          ),
        );
      });

      test('throws MarketDataException listing all 7 missing fields for empty map', () {
        expect(
          () => AssetPrice.fromJson({}),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              allOf(
                contains('symbol'),
                contains('price'),
                contains('dailyHigh'),
                contains('dailyLow'),
                contains('volume'),
                contains('percentageChange'),
                contains('timestamp'),
              ),
            ),
          ),
        );
      });

      test('missing fields message starts with "Missing required fields:"', () {
        final json = validJson()..remove('symbol');

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              startsWith('Missing required fields:'),
            ),
          ),
        );
      });
    });

    group('type validation', () {
      test('throws when symbol is not String', () {
        final json = validJson()..['symbol'] = 123;

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              allOf(contains('symbol'), contains('String')),
            ),
          ),
        );
      });

      test('throws when price is not num', () {
        final json = validJson()..['price'] = 'not-a-number';

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              allOf(contains('price'), contains('num')),
            ),
          ),
        );
      });

      test('throws when dailyHigh is not num', () {
        final json = validJson()..['dailyHigh'] = true;

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              allOf(contains('dailyHigh'), contains('num')),
            ),
          ),
        );
      });

      test('throws when dailyLow is not num', () {
        final json = validJson()..['dailyLow'] = [];

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              allOf(contains('dailyLow'), contains('num')),
            ),
          ),
        );
      });

      test('throws when volume is not num', () {
        final json = validJson()..['volume'] = 'high';

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              allOf(contains('volume'), contains('num')),
            ),
          ),
        );
      });

      test('throws when percentageChange is not num', () {
        final json = validJson()..['percentageChange'] = {};

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              allOf(contains('percentageChange'), contains('num')),
            ),
          ),
        );
      });

      test('throws when timestamp is not String', () {
        final json = validJson()..['timestamp'] = 12345;

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              allOf(contains('timestamp'), contains('String')),
            ),
          ),
        );
      });

      test('throws when field value is null (treated as wrong type)', () {
        final json = validJson()..['price'] = null;

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              allOf(contains('price'), contains('num')),
            ),
          ),
        );
      });

      test('throws when symbol is null', () {
        final json = validJson()..['symbol'] = null;

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              allOf(contains('symbol'), contains('String')),
            ),
          ),
        );
      });
    });

    group('invalid timestamp validation', () {
      test('throws for non-ISO-8601 string', () {
        final json = validJson()..['timestamp'] = 'not-a-date';

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              contains('not-a-date'),
            ),
          ),
        );
      });

      test('throws for completely unparseable date string', () {
        final json = validJson()..['timestamp'] = 'yesterday at noon';

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              contains('yesterday at noon'),
            ),
          ),
        );
      });

      test('throws for empty string timestamp', () {
        final json = validJson()..['timestamp'] = '';

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              contains('timestamp'),
            ),
          ),
        );
      });

      test('throws for random garbage string', () {
        final json = validJson()..['timestamp'] = 'abc123xyz';

        expect(
          () => AssetPrice.fromJson(json),
          throwsA(
            isA<MarketDataException>().having(
              (e) => e.message,
              'message',
              contains('abc123xyz'),
            ),
          ),
        );
      });
    });

    group('toJson round-trip', () {
      test('toJson then fromJson produces equal AssetPrice', () {
        final original = AssetPrice(
          symbol: 'MSFT',
          price: 420.50,
          dailyHigh: 425.00,
          dailyLow: 418.30,
          volume: 30000000.0,
          percentageChange: -0.75,
          timestamp: DateTime.utc(2024, 3, 10, 9, 30, 0),
        );

        final json = original.toJson();
        final restored = AssetPrice.fromJson(json);

        expect(restored.symbol, original.symbol);
        expect(restored.price, original.price);
        expect(restored.dailyHigh, original.dailyHigh);
        expect(restored.dailyLow, original.dailyLow);
        expect(restored.volume, original.volume);
        expect(restored.percentageChange, original.percentageChange);
        expect(restored.timestamp, original.timestamp);
        expect(restored, original);
      });

      test('round-trip preserves integer-valued doubles', () {
        final original = AssetPrice(
          symbol: 'GOOG',
          price: 150.0,
          dailyHigh: 155.0,
          dailyLow: 145.0,
          volume: 5000000.0,
          percentageChange: 0.0,
          timestamp: DateTime.utc(2024, 6, 15, 12, 0, 0),
        );

        final restored = AssetPrice.fromJson(original.toJson());
        expect(restored, original);
      });

      test('round-trip normalizes timestamp to UTC', () {
        final original = AssetPrice(
          symbol: 'TSLA',
          price: 250.0,
          dailyHigh: 260.0,
          dailyLow: 240.0,
          volume: 80000000.0,
          percentageChange: 3.5,
          timestamp: DateTime.utc(2024, 2, 1, 15, 0, 0),
        );

        final json = original.toJson();
        final restored = AssetPrice.fromJson(json);

        expect(restored.timestamp.isUtc, isTrue);
        expect(restored.timestamp, original.timestamp);
      });
    });
  });
}
