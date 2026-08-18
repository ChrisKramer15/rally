import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rally/data/services/watchlist_store.dart';
import 'package:rally/domain/models/watchlist_change_result.dart';

/// Feature: live-market-data
/// Property-based tests for watchlist store
///
/// Property 1: Watchlist add is set-like
/// "For any watchlist state and any valid symbol, adding the symbol to the
/// watchlist results in the symbol appearing exactly once in the watchlist —
/// regardless of whether it was already present. If it was already present,
/// the watchlist remains unchanged."
///
/// **Validates: Requirements 1.1, 1.6**
///
/// Property 2: Watchlist remove then absent
/// **Validates: Requirements 1.2**
///
/// Property 3: Watchlist persistence round-trip
/// "For any valid watchlist (list of 0–50 unique symbol strings), persisting
/// the watchlist to storage and then loading it back produces an identical
/// list of symbols."
///
/// **Validates: Requirements 1.3**
///
/// Property 4: Watchlist capacity invariant
/// "For any sequence of add operations applied to a watchlist, the resulting
/// watchlist length shall never exceed 50. Adds attempted when at capacity
/// are rejected without modifying the watchlist."
///
/// **Validates: Requirements 1.7**
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group(
      'Feature: live-market-data, '
      'Property 1: Watchlist add is set-like', () {
    // **Validates: Requirements 1.1, 1.6**

    property(
        'adding a symbol results in it appearing exactly once in the watchlist',
        () {
      // Generator for random symbol strings (1–10 uppercase chars)
      final symbolArb = integer(min: 1, max: 10).flatMap((length) {
        return list(
          integer(min: 65, max: 90).map((code) => String.fromCharCode(code)),
          minLength: length,
          maxLength: length,
        ).map((chars) => chars.join());
      });

      // Generator for random existing watchlist (0–49 entries to leave room)
      final existingWatchlistArb = integer(min: 0, max: 49).flatMap((size) {
        return list(
          integer(min: 1, max: 10).flatMap((len) {
            return list(
              integer(min: 65, max: 90)
                  .map((code) => String.fromCharCode(code)),
              minLength: len,
              maxLength: len,
            ).map((chars) => chars.join());
          }),
          minLength: size + 10,
          maxLength: size + 30,
        ).map((symbols) {
          final unique = symbols.toSet().toList();
          return unique.take(size).toList();
        });
      });

      forAll(
        combine2(symbolArb, existingWatchlistArb),
        (tuple) async {
          final symbolToAdd = tuple.$1;
          final existingSymbols = tuple.$2;

          // Set up SharedPreferences with the existing watchlist
          SharedPreferences.setMockInitialValues(
            {'watchlist_symbols': existingSymbols},
          );
          final prefs = await SharedPreferences.getInstance();
          final store = WatchlistStore(prefs: prefs);

          // Capture state before adding
          final watchlistBefore = store.getWatchlist();
          final wasAlreadyPresent = watchlistBefore.contains(symbolToAdd);

          // Add the symbol
          await store.addSymbol(symbolToAdd);

          // Get the resulting watchlist
          final watchlistAfter = store.getWatchlist();

          // The symbol must appear exactly once
          final occurrences =
              watchlistAfter.where((s) => s == symbolToAdd).length;
          expect(occurrences, equals(1),
              reason:
                  'Symbol "$symbolToAdd" should appear exactly once in the '
                  'watchlist, but appeared $occurrences times');

          // If the symbol was already present, the watchlist should be unchanged
          if (wasAlreadyPresent) {
            expect(watchlistAfter, equals(watchlistBefore),
                reason:
                    'Watchlist should remain unchanged when adding an '
                    'existing symbol');
          }
        },
        maxExamples: 100,
      );
    });

    property(
        'adding an already-present symbol returns WatchlistAlreadyExists and does not modify the watchlist',
        () {
      // Generator for random existing watchlist with at least 1 entry
      final existingWatchlistArb = integer(min: 1, max: 49).flatMap((size) {
        return list(
          integer(min: 1, max: 10).flatMap((len) {
            return list(
              integer(min: 65, max: 90)
                  .map((code) => String.fromCharCode(code)),
              minLength: len,
              maxLength: len,
            ).map((chars) => chars.join());
          }),
          minLength: size + 10,
          maxLength: size + 30,
        ).map((symbols) {
          final unique = symbols.toSet().toList();
          return unique.take(size).toList();
        });
      });

      forAll(
        existingWatchlistArb,
        (existingSymbols) async {
          if (existingSymbols.isEmpty) return;

          // Pick the first symbol that is already in the watchlist
          final symbolToAdd = existingSymbols[0];

          // Set up SharedPreferences with the existing watchlist
          SharedPreferences.setMockInitialValues(
            {'watchlist_symbols': existingSymbols},
          );
          final prefs = await SharedPreferences.getInstance();
          final store = WatchlistStore(prefs: prefs);

          // Capture state before adding
          final watchlistBefore = store.getWatchlist();

          // Add the symbol that is already present
          final result = await store.addSymbol(symbolToAdd);

          // Should return WatchlistAlreadyExists
          expect(result, isA<WatchlistAlreadyExists>(),
              reason:
                  'Adding an existing symbol should return '
                  'WatchlistAlreadyExists');

          // Watchlist should remain unchanged
          final watchlistAfter = store.getWatchlist();
          expect(watchlistAfter, equals(watchlistBefore),
              reason:
                  'Watchlist should remain unchanged when adding a '
                  'duplicate symbol');
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: live-market-data, '
      'Property 2: Watchlist remove then absent', () {
    // **Validates: Requirements 1.2**
    //
    // For any watchlist containing at least one symbol, removing a symbol
    // from the watchlist results in that symbol no longer being present in
    // the watchlist, and the watchlist length decreasing by exactly one.

    property(
        'removing a symbol makes it absent and reduces length by one', () {
      forAll(
        combine2(
          // Generate a list size between 1 and 50
          integer(min: 1, max: 50),
          // Random seed for selecting which symbol to remove
          integer(min: 0, max: 999999),
        ),
        (values) async {
          final listSize = values.$1;
          final removeSeed = values.$2;

          // Generate a unique list of symbol strings
          final symbols = List.generate(
            listSize,
            (i) => 'SYM${i.toString().padLeft(3, '0')}',
          );

          // Pick a random symbol from the list to remove
          final indexToRemove = removeSeed % symbols.length;
          final symbolToRemove = symbols[indexToRemove];

          // Set up SharedPreferences mock with initial watchlist
          SharedPreferences.setMockInitialValues({
            'watchlist_symbols': List<String>.from(symbols),
          });
          final prefs = await SharedPreferences.getInstance();
          final store = WatchlistStore(prefs: prefs);

          // Record length before removal
          final lengthBefore = store.getWatchlist().length;
          expect(lengthBefore, equals(listSize));
          expect(store.contains(symbolToRemove), isTrue);

          // Remove the symbol
          final result = await store.removeSymbol(symbolToRemove);

          // Verify the result type
          expect(result, isA<WatchlistSymbolRemoved>());

          // Verify the symbol is no longer present
          expect(store.contains(symbolToRemove), isFalse,
              reason:
                  'Symbol "$symbolToRemove" should be absent after removal');

          // Verify the length decreased by exactly one
          final lengthAfter = store.getWatchlist().length;
          expect(lengthAfter, equals(lengthBefore - 1),
              reason:
                  'Watchlist length should decrease by 1: '
                  'was $lengthBefore, now $lengthAfter');
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: live-market-data, '
      'Property 3: Watchlist persistence round-trip', () {
    // **Validates: Requirements 1.3**

    property(
        'persisting symbols via SharedPreferences and loading them back produces identical list',
        () {
      // Generator for a list of 0–50 unique uppercase symbol strings (1–10 chars each)
      final uniqueSymbolListArb = integer(min: 0, max: 50).flatMap((size) {
        return list(
          integer(min: 1, max: 10).flatMap((length) {
            return list(
              integer(min: 65, max: 90)
                  .map((code) => String.fromCharCode(code)),
              minLength: length,
              maxLength: length,
            ).map((chars) => chars.join());
          }),
          minLength: size + 10,
          maxLength: size + 30,
        ).map((symbols) {
          final unique = symbols.toSet().toList();
          return unique.take(size).toList();
        });
      });

      forAll(
        uniqueSymbolListArb,
        (symbols) async {
          // Set up SharedPreferences with the generated symbols already persisted
          SharedPreferences.setMockInitialValues(
              {'watchlist_symbols': symbols});

          final prefs = await SharedPreferences.getInstance();

          // Create a WatchlistStore that loads from SharedPreferences
          final store = WatchlistStore(prefs: prefs);

          // Verify getWatchlist() returns the same list
          final loaded = store.getWatchlist();
          expect(loaded, equals(symbols),
              reason:
                  'Loading persisted watchlist should produce identical list. '
                  'Expected $symbols but got $loaded');
        },
        maxExamples: 100,
      );
    });

    property(
        'adding symbols one-by-one and loading from new store produces same list',
        () {
      // Generator for a list of 0–50 unique uppercase symbol strings (1–10 chars each)
      final uniqueSymbolListArb = integer(min: 0, max: 50).flatMap((size) {
        return list(
          integer(min: 1, max: 10).flatMap((length) {
            return list(
              integer(min: 65, max: 90)
                  .map((code) => String.fromCharCode(code)),
              minLength: length,
              maxLength: length,
            ).map((chars) => chars.join());
          }),
          minLength: size + 10,
          maxLength: size + 30,
        ).map((symbols) {
          final unique = symbols.toSet().toList();
          return unique.take(size).toList();
        });
      });

      forAll(
        uniqueSymbolListArb,
        (symbols) async {
          // Start with an empty SharedPreferences
          SharedPreferences.setMockInitialValues({});

          final prefs = await SharedPreferences.getInstance();

          // Create first store and add symbols one-by-one
          final store1 = WatchlistStore(prefs: prefs);
          for (final symbol in symbols) {
            await store1.addSymbol(symbol);
          }

          // Verify the first store has the expected symbols
          expect(store1.getWatchlist(), equals(symbols),
              reason: 'Store should contain all added symbols in order');

          // Create a NEW store from the same SharedPreferences instance
          // to verify persistence round-trip
          final store2 = WatchlistStore(prefs: prefs);
          final loaded = store2.getWatchlist();

          expect(loaded, equals(symbols),
              reason:
                  'New store loaded from same SharedPreferences should produce '
                  'identical list. Expected $symbols but got $loaded');
        },
        maxExamples: 100,
      );
    });
  });

  group(
      'Feature: live-market-data, '
      'Property 4: Watchlist capacity invariant', () {
    // **Validates: Requirements 1.7**

    property(
        'adding a symbol to a full watchlist returns WatchlistAtCapacity and length stays 50',
        () {
      // Generate a random symbol to try adding (1-10 uppercase chars)
      final newSymbolArb = integer(min: 1, max: 10).flatMap((length) {
        return list(
          integer(min: 65, max: 90).map((code) => String.fromCharCode(code)),
          minLength: length,
          maxLength: length,
        ).map((chars) => chars.join());
      });

      forAll(
        newSymbolArb,
        (newSymbol) async {
          // Create a watchlist already at capacity with 50 unique symbols
          final fiftySymbols =
              List.generate(50, (i) => 'SYM${i.toString().padLeft(3, '0')}');

          // Ensure the new symbol is not already in the list
          final symbolToAdd = 'NEW$newSymbol';

          SharedPreferences.setMockInitialValues({
            'watchlist_symbols': fiftySymbols,
          });

          final prefs = await SharedPreferences.getInstance();
          final store = WatchlistStore(prefs: prefs);

          // Verify we start at capacity
          expect(store.isAtCapacity(), isTrue,
              reason: 'Watchlist should start at capacity (50)');
          expect(store.getWatchlist().length, equals(50),
              reason: 'Watchlist should have exactly 50 entries');

          // Attempt to add a new symbol
          final result = await store.addSymbol(symbolToAdd);

          // Verify the add was rejected
          expect(result, isA<WatchlistAtCapacity>(),
              reason:
                  'Adding to a full watchlist should return WatchlistAtCapacity');

          // Verify length never exceeded 50
          expect(store.getWatchlist().length, equals(50),
              reason: 'Watchlist length must never exceed 50');

          // Verify the symbol was not added
          expect(store.contains(symbolToAdd), isFalse,
              reason: 'Rejected symbol should not appear in watchlist');
        },
        maxExamples: 100,
      );
    });

    property(
        'multiple sequential adds to a full watchlist all get rejected and length remains 50',
        () {
      // Generate a count of how many extra adds to attempt (2-10)
      final addCountArb = integer(min: 2, max: 10);

      forAll(
        addCountArb,
        (addCount) async {
          // Create a watchlist already at capacity with 50 unique symbols
          final fiftySymbols = List.generate(
              50, (i) => 'STOCK${i.toString().padLeft(3, '0')}');

          SharedPreferences.setMockInitialValues({
            'watchlist_symbols': fiftySymbols,
          });

          final prefs = await SharedPreferences.getInstance();
          final store = WatchlistStore(prefs: prefs);

          // Attempt multiple adds beyond capacity
          for (int i = 0; i < addCount; i++) {
            final result = await store.addSymbol('EXTRA$i');

            expect(result, isA<WatchlistAtCapacity>(),
                reason:
                    'Add attempt ${i + 1} should return WatchlistAtCapacity');
            expect(store.getWatchlist().length, equals(50),
                reason:
                    'Length must remain 50 after add attempt ${i + 1}');
          }

          // Final invariant check
          expect(store.isAtCapacity(), isTrue);
          expect(store.getWatchlist().length, equals(50));
        },
        maxExamples: 100,
      );
    });
  });
}
