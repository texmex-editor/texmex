namespace TexMex.Data.Services;

public static class AnonymousNameGenerator
{
    private static readonly string[] Animals =
    [
        "Cat", "Dog", "Horse", "Lion", "Elephant", "Giraffe", "Monkey", "Raccoon",
        "Hedgehog", "Sloth", "Capybara", "Axolotl", "Red Panda", "Panda", "Penguin", "Otter",
        "Fox", "Owl", "Koala", "Dolphin", "Falcon", "Turtle", "Rabbit", "Wolf",
        "Eagle", "Bear", "Lynx", "Hawk", "Seal","Deer", "Crane", "Badger",
        "Raven", "Heron", "Bison", "Jaguar", "Parrot", "Tiger", "Whale", "Gecko",
        "Puma", "Ibis", "Orca", "Newt", "Elk", "Robin", "Swan", "Moth", "Wren",
        "Finch", "Dove", "Jay", "Lark", "Mole", "Toad", "Viper", "Cobra", "Shark",
        "Crab", "Clam", "Squid",
    ];

    public static string Generate()
    {
        var animal = Animals[Random.Shared.Next(Animals.Length)];
        return $"Anonymous {animal}";
    }

    public static string GenerateUnique(IEnumerable<string> existingNames)
    {
        var taken = existingNames.ToHashSet();

        // Try up to Animals.Length times to find an unused name
        for (var i = 0; i < Animals.Length; i++)
        {
            var name = $"Anonymous {Animals[Random.Shared.Next(Animals.Length)]}";
            if (!taken.Contains(name))
                return name;
        }

        // Fallback: append a number
        var baseName = $"Anonymous {Animals[Random.Shared.Next(Animals.Length)]}";
        var counter = 2;
        while (taken.Contains($"{baseName} {counter}"))
            counter++;
        return $"{baseName} {counter}";
    }
}
