
from animal import Animals

class Cats(Animal):

    def speak(self):  # <--- Should have CodeLens
        print("Meow")

    def meow(self):   # <--- Should NOT have CodeLens (new method)
        print("Meow") 