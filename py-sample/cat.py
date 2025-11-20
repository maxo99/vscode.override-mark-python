
from animal import Animal

class Cat(Animal):
    def speak(self):  # <--- Should have an arrow icon in the gutter
        print("Meow")
    def meow(self):   # <--- Should NOT have an icon (new method)
        print("Meow") 